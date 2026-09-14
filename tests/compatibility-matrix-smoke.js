"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const compatibilityRoot = path.join(root, "compatibility");
const matrix = readJson(path.join(compatibilityRoot, "matrix.json"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const smokeSource = fs.readFileSync(
    path.join(root, "tests", "XQueryInspector.SmokeTests", "Program.cs"),
    "utf8"
);
const expectedBuilds = ["434", "906", "1132", "1333", "1525"];
const expectedProviders = ["MSSQL", "PostgreSQL"];

assert(matrix.schemaVersion === 1, "Unsupported matrix schema version.");
assert(Array.isArray(matrix.runtimeStructures), "runtimeStructures must be an array.");
assert(Array.isArray(matrix.environments), "environments must be an array.");

const structures = new Map();
for (const structure of matrix.runtimeStructures) {
    assert(structure.id && !structures.has(structure.id), "Runtime structure ids must be unique.");
    assert(structure.reflectionPath, "Runtime structure has no reflectionPath.");
    assert(structure.smokeScenario, "Runtime structure has no smokeScenario.");
    assert(
        smokeSource.includes('"' + structure.smokeScenario + '"'),
        "Missing C# smoke scenario " + structure.smokeScenario + "."
    );
    structures.set(structure.id, structure);
}

assert(matrix.environments.length === 10, "The matrix must contain exactly 5 x 2 environments.");
const environments = new Map();
const verifiedReadmeRows = new Map(parseVerifiedReadmeRows(readme));

for (const environment of matrix.environments) {
    const key = environment.build + ":" + environment.provider;
    assert(expectedBuilds.includes(environment.build), "Unexpected build " + environment.build + ".");
    assert(expectedProviders.includes(environment.provider), "Unexpected provider " + environment.provider + ".");
    assert(!environments.has(key), "Duplicate matrix environment " + key + ".");
    assert(structures.has(environment.runtimeStructure), "Unknown runtime structure for " + key + ".");
    assert(
        environment.status === "verified" || environment.status === "not-tested",
        "Unexpected status for " + key + "."
    );
    assert(environment.websoftVersion, "Missing WebSoft version for " + key + ".");
    assert(environment.unibridgeVersion, "Missing UniBridge version for " + key + ".");
    assert(environment.providerVersion, "Missing provider version for " + key + ".");
    assert(environment.runtimeTarget, "Missing runtime target for " + key + ".");

    const readmeKey = environment.websoftVersion + ":" + environment.provider;
    if (environment.status === "verified") {
        assert(
            environment.coverage === "full-protocol"
                || environment.coverage === "partial-protocol",
            "Verified environment has no protocol coverage: " + key + "."
        );
        assert(verifiedReadmeRows.has(readmeKey), "Verified environment is missing in README: " + key + ".");
        const readmeResult = verifiedReadmeRows.get(readmeKey);
        if (environment.coverage === "full-protocol") {
            assert(
                readmeResult === "Полный протокол совместимости подтверждён",
                "Full protocol is not advertised consistently in README: " + key + "."
            );
        } else {
            assert(
                readmeResult.includes("частичный протокол"),
                "Partial protocol is not identified in README: " + key + "."
            );
        }
    } else {
        assert(environment.reason, "Untested environment has no reason: " + key + ".");
        assert(!environment.coverage, "Untested environment has protocol coverage: " + key + ".");
        assert(!verifiedReadmeRows.has(readmeKey), "Untested environment is advertised in README: " + key + ".");
    }

    environments.set(key, environment);
}

for (const build of expectedBuilds) {
    for (const provider of expectedProviders) {
        assert(environments.has(build + ":" + provider), "Missing environment " + build + ":" + provider + ".");
    }
}

assert(
    verifiedReadmeRows.size === matrix.environments.filter(item => item.status === "verified").length,
    "README contains a verified environment absent from the matrix."
);

console.log("Compatibility matrix smoke tests passed.");

function parseVerifiedReadmeRows(content) {
    const rows = [];
    const table = content.match(/## Проверенная совместимость\s+([\s\S]*?)(?:\n\n[^|])/);
    assert(table, "README compatibility table was not found.");
    for (const line of table[1].split(/\r?\n/)) {
        const match = line.match(
            /^\| `([^`]+)` \| `[^`]+` \| (MSSQL|PostgreSQL) `[^`]+` \| (.+) \|$/
        );
        if (match) {
            rows.push([match[1] + ":" + match[2], match[3]]);
        }
    }
    return rows;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
