"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const compatibilityRoot = path.join(root, "compatibility");
const manifestPath = path.join(compatibilityRoot, "scenarios.json");
const matrixPath = path.join(compatibilityRoot, "matrix.json");
const projectPath = path.join(root, "src", "XQueryInspector", "XQueryInspector.csproj");
const inspectorPath = path.join(root, "src", "XQueryInspector", "Inspector.cs");
const sourcePath = path.join(
    root,
    "websoft",
    "src-agent",
    "compatibility-agent.js"
);
const outputPath = path.join(
    root,
    "websoft",
    "xquery-inspector-compatibility-agent.js"
);
const checkOnly = process.argv.length === 3 && process.argv[2] === "--check";

if (process.argv.length > 2 && !checkOnly) {
    console.error("Usage: node tools/build-compatibility-agent.js [--check]");
    process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.scenarios)) {
    console.error("Unsupported compatibility scenario manifest.");
    process.exit(1);
}

const scenarioIds = new Set();
const supportedKinds = new Set([
    "basic",
    "boundary",
    "execution",
    "hierarchy",
    "invalid",
    "oversized"
]);
const supportedProviders = new Set(["mssql", "postgresql"]);
const scenarios = manifest.scenarios.map(scenario => {
    if (!scenario.id || scenarioIds.has(scenario.id) || !scenario.kind) {
        console.error("Compatibility scenarios require unique ids and kinds.");
        process.exit(1);
    }
    scenarioIds.add(scenario.id);
    if (!supportedKinds.has(scenario.kind)) {
        console.error("Unsupported scenario kind: " + scenario.kind);
        process.exit(1);
    }
    if (scenario.provider && !supportedProviders.has(scenario.provider)) {
        console.error("Unsupported scenario provider: " + scenario.provider);
        process.exit(1);
    }

    const built = {
        id: scenario.id,
        kind: scenario.kind,
        expectedFailureStage: null,
        expectedParameterValue: null,
        provider: null,
        xquery: null,
        generated: null
    };
    if (scenario.expectedFailureStage) {
        built.expectedFailureStage = scenario.expectedFailureStage;
    }
    if (scenario.expectedParameterValue) {
        built.expectedParameterValue = scenario.expectedParameterValue;
    }
    if (scenario.provider) {
        built.provider = scenario.provider;
    }
    if (scenario.xqueryFile) {
        const queryPath = path.resolve(compatibilityRoot, scenario.xqueryFile);
        if (!queryPath.startsWith(compatibilityRoot + path.sep)) {
            console.error("Scenario path escapes compatibility/: " + scenario.xqueryFile);
            process.exit(1);
        }
        built.xquery = fs.readFileSync(queryPath, "utf8")
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?/g, "\n")
            .trim();
        if (!built.xquery) {
            console.error("Scenario XQuery is empty: " + scenario.id);
            process.exit(1);
        }
    } else if (scenario.generated) {
        if (
            scenario.generated !== "max-xquery"
            && scenario.generated !== "max-xquery-plus-one"
        ) {
            console.error("Unsupported generated scenario: " + scenario.generated);
            process.exit(1);
        }
        built.generated = scenario.generated;
    } else {
        console.error("Scenario has neither xqueryFile nor generated value: " + scenario.id);
        process.exit(1);
    }
    return built;
});
const requiredScenarioIds = [
    "basic-parameter",
    "basic-execution",
    "hierarchy-child",
    "hierarchy-self",
    "invalid-query",
    "invalid-provider-query",
    "max-length-xquery",
    "oversized-xquery"
];
for (const scenarioId of requiredScenarioIds) {
    if (!scenarioIds.has(scenarioId)) {
        console.error("Required compatibility scenario is missing: " + scenarioId);
        process.exit(1);
    }
}
if (scenarios[0].id !== "basic-parameter") {
    console.error("basic-parameter must run first to detect the SQL provider.");
    process.exit(1);
}

const project = fs.readFileSync(projectPath, "utf8");
const versionMatch = project.match(/<Version>([^<]+)<\/Version>/);
if (!versionMatch) {
    console.error("XQueryInspector project version was not found.");
    process.exit(1);
}
const inspectorSource = fs.readFileSync(inspectorPath, "utf8");
const contractMatch = inspectorSource.match(/private const int ContractVersion = (\d+);/);
const limitMatch = inspectorSource.match(/public const int MaxXQueryLength = (\d+);/);
if (!contractMatch || !limitMatch) {
    console.error("Inspector contract version or XQuery limit was not found.");
    process.exit(1);
}
if (!Array.isArray(matrix.runtimeStructures) || matrix.runtimeStructures.length === 0) {
    console.error("Compatibility matrix has no runtime structures.");
    process.exit(1);
}
const reflectionPaths = Array.from(new Set(
    matrix.runtimeStructures.map(structure => structure.reflectionPath)
));
if (reflectionPaths.some(value => !value)) {
    console.error("Compatibility matrix contains an empty reflection path.");
    process.exit(1);
}

let source = fs.readFileSync(sourcePath, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
const replacements = new Map([
    ["__XQI_SCENARIOS__", JSON.stringify(scenarios, null, 4)],
    ["__XQI_INSPECTOR_VERSION__", JSON.stringify(versionMatch[1])],
    ["__XQI_REFLECTION_PATHS__", JSON.stringify(reflectionPaths)],
    ["__XQI_CONTRACT_VERSION__", contractMatch[1]],
    ["__XQI_MAX_XQUERY_LENGTH__", limitMatch[1]]
]);
for (const [marker, replacement] of replacements) {
    if (source.split(marker).length !== 2) {
        console.error("Compatibility agent source must contain one " + marker + " marker.");
        process.exit(1);
    }
    source = source.replace(marker, replacement);
}

const content = source.replace(/\n/g, "\r\n");
const expected = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(content, "utf8")
]);

if (checkOnly) {
    let actual;
    try {
        actual = fs.readFileSync(outputPath);
    } catch (error) {
        console.error("Generated compatibility agent is missing: " + outputPath);
        process.exit(1);
    }
    if (!actual.equals(expected)) {
        console.error(
            "Generated compatibility agent is out of date. Run: "
                + "node tools/build-compatibility-agent.js"
        );
        process.exit(1);
    }
    console.log("Generated compatibility agent is up to date.");
} else {
    fs.writeFileSync(outputPath, expected);
    console.log("Built " + path.relative(root, outputPath));
}
