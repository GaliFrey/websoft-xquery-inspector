"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const tracked = git(["ls-files", "-z"])
    .split("\0")
    .filter(file => file && fs.existsSync(path.join(root, file)));
const failures = [];

const exactPublicFiles = new Set([
    ".gitattributes",
    ".gitignore",
    "README.md",
    "global.json",
    "websoft-xquery-inspector.sln"
]);
const publicPrefixes = [
    ".github/",
    "compatibility/",
    "src/",
    "tests/",
    "tools/",
    "websoft/"
];
const allowedLicense = /^(LICENSE|NOTICE)(\.[A-Za-z0-9_-]+)?$/;

for (const file of tracked) {
    if (
        !exactPublicFiles.has(file)
        && !allowedLicense.test(file)
        && !publicPrefixes.some(prefix => file.startsWith(prefix))
    ) {
        failures.push("Tracked path is outside the public allowlist: " + file);
    }
}

const forbiddenPaths = [
    "specs/",
    "references/",
    "compatibility/results/",
    ".agents/",
    [".code", "x/"].join("")
];
for (const file of tracked) {
    if (
        file === "history.md"
        || file === "roadmap.md"
        || file === "AGENTS.md"
        || forbiddenPaths.some(prefix => file.startsWith(prefix))
    ) {
        failures.push("Internal path is tracked: " + file);
    }
}

const markerNames = [
    ["Open", "AI"].join(""),
    ["Chat", "GPT"].join(""),
    ["Code", "x"].join(""),
    ["Co", "pilot"].join(""),
    ["Clau", "de"].join(""),
    ["Gem", "ini"].join("")
];
const localPathPatterns = [
    new RegExp("/" + "home" + "/", "i"),
    new RegExp("/" + "Users" + "/", "i"),
    new RegExp("[A-Z]:" + "\\\\" + "Users" + "\\\\", "i")
];
const secretPatterns = [
    {
        name: "private-key",
        pattern: new RegExp(
            ["BE", "GIN"].join("") + " " + ".{0,24}" + ["PRIVATE", " KEY"].join("")
        )
    },
    { name: "aws-access-key", pattern: new RegExp("AKIA" + "[A-Z0-9]{16}") },
    { name: "github-token", pattern: new RegExp("gh" + "[pousr]_[A-Za-z0-9]{30,}") },
    { name: ["provider", "-key"].join(""), pattern: new RegExp("sk" + "-[A-Za-z0-9_-]{32,}") },
    {
        name: "assigned-secret",
        pattern: new RegExp(
            "(?:api[_-]?key|client[_-]?secret|password)" +
            "\\s*[:=]\\s*[\\\"'][^\\\"'\\s]{12,}[\\\"']",
            "i"
        )
    }
];

for (const file of tracked) {
    const filePath = path.join(root, file);
    const content = fs.readFileSync(filePath);
    if (content.includes(0)) {
        continue;
    }

    const text = content.toString("utf8");
    for (const marker of markerNames) {
        if (file !== ".gitignore" && text.toLowerCase().includes(marker.toLowerCase())) {
            failures.push("AI marker " + marker + " found in " + file);
        }
    }
    for (const pattern of localPathPatterns) {
        if (pattern.test(text)) {
            failures.push("Absolute local path found in " + file);
        }
    }
    for (const secret of secretPatterns) {
        if (secret.pattern.test(text)) {
            failures.push("Potential " + secret.name + " found in " + file);
        }
    }

    if (file.endsWith(".md")) {
        verifyMarkdownLinks(file, text);
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(failure);
    }
    process.exit(1);
}

console.log(
    "Public tree check passed for " + tracked.length
        + " tracked files; no internal paths, known AI markers, local absolute paths,"
        + " broken relative Markdown links, or built-in secret signatures found."
);

function verifyMarkdownLinks(file, content) {
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
        const target = match[1].split("#", 1)[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
            continue;
        }

        const decoded = decodeURIComponent(target.replace(/^<|>$/g, ""));
        const resolved = path.resolve(root, path.dirname(file), decoded);
        if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
            failures.push("Broken or escaping Markdown link in " + file + ": " + target);
        }
    }
}

function git(args) {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8"
    });
}
