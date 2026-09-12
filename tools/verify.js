"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const templatePath = path.join(
    repositoryRoot,
    "websoft",
    "websoft-xquery-inspector.html"
);

const steps = [
    {
        name: "Build WebSoft template",
        command: process.execPath,
        args: ["tools/build-template.js"]
    },
    {
        name: "Build compatibility agent",
        command: process.execPath,
        args: ["tools/build-compatibility-agent.js"]
    },
    {
        name: "Release build",
        command: "dotnet",
        args: ["build", "websoft-xquery-inspector.sln", "-c", "Release", "-m:1"]
    },
    {
        name: ".NET 6 smoke tests",
        command: "dotnet",
        args: [
            "run",
            "--project",
            "tests/XQueryInspector.SmokeTests/XQueryInspector.SmokeTests.csproj",
            "-f",
            "net6.0",
            "-c",
            "Release",
            "--no-build"
        ]
    },
    {
        name: ".NET 9 smoke tests",
        command: "dotnet",
        args: [
            "run",
            "--project",
            "tests/XQueryInspector.SmokeTests/XQueryInspector.SmokeTests.csproj",
            "-f",
            "net9.0",
            "-c",
            "Release",
            "--no-build"
        ]
    },
    {
        name: "Template contract smoke tests",
        command: process.execPath,
        args: ["tests/template-contract-smoke.js"]
    },
    {
        name: "Compatibility matrix smoke tests",
        command: process.execPath,
        args: ["tests/compatibility-matrix-smoke.js"]
    },
    {
        name: "Compatibility agent smoke tests",
        command: process.execPath,
        args: ["tests/compatibility-agent-smoke.js"]
    },
    {
        name: "Public repository hygiene",
        command: process.execPath,
        args: ["tools/check-public-tree.js"]
    }
];

for (const step of steps) {
    run(step.name, step.command, step.args);
}

console.log("\n==> Template BOM and CRLF");
verifyTemplateEncoding();
console.log("Template has a UTF-8 BOM and CRLF line endings.");

run("Git whitespace check", "git", ["diff", "--check"]);

console.log("\nAll verification steps passed.");

function run(name, command, args) {
    console.log("\n==> " + name);

    const result = spawnSync(command, args, {
        cwd: repositoryRoot,
        stdio: "inherit"
    });

    if (result.error) {
        console.error("Unable to start " + command + ": " + result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function verifyTemplateEncoding() {
    const content = fs.readFileSync(templatePath);

    if (
        content.length < 3
        || content[0] !== 0xef
        || content[1] !== 0xbb
        || content[2] !== 0xbf
    ) {
        console.error("Template UTF-8 BOM is missing.");
        process.exit(1);
    }

    for (let index = 3; index < content.length; index += 1) {
        if (content[index] === 0x0a && content[index - 1] !== 0x0d) {
            console.error("Template contains an LF line ending without CR.");
            process.exit(1);
        }

        if (content[index] === 0x0d && content[index + 1] !== 0x0a) {
            console.error("Template contains a CR line ending without LF.");
            process.exit(1);
        }
    }
}
