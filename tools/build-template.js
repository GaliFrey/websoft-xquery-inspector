"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(repositoryRoot, "websoft", "src");
const outputPath = path.join(
    repositoryRoot,
    "websoft",
    "websoft-xquery-inspector.html"
);
const checkOnly = process.argv.length === 3 && process.argv[2] === "--check";

if (process.argv.length > 2 && !checkOnly) {
    console.error("Usage: node tools/build-template.js [--check]");
    process.exit(2);
}

const sections = [
    readSource("server-prefix.html"),
    "<style>\n",
    readSource("styles.css"),
    "    </style>\n",
    readSource("fragment.html"),
    "\n    <script>\n",
    readSource("client.js"),
    "    </script>\n",
    readSource("server-suffix.html")
];
const content = sections.join("").replace(/\n/g, "\r\n");
const expected = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(content, "utf8")
]);

if (checkOnly) {
    let actual;
    try {
        actual = fs.readFileSync(outputPath);
    } catch (error) {
        console.error("Generated template is missing: " + outputPath);
        process.exit(1);
    }

    if (!actual.equals(expected)) {
        console.error(
            "Generated template is out of date. Run: node tools/build-template.js"
        );
        process.exit(1);
    }

    console.log("Generated template is up to date.");
} else {
    fs.writeFileSync(outputPath, expected);
    console.log("Built " + path.relative(repositoryRoot, outputPath));
}

function readSource(fileName) {
    const sourcePath = path.join(sourceRoot, fileName);
    return fs.readFileSync(sourcePath, "utf8")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n");
}
