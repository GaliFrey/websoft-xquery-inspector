"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const agentPath = path.join(
    root,
    "websoft",
    "xquery-inspector-compatibility-agent.js"
);
const agentBytes = fs.readFileSync(agentPath);
const agent = agentBytes.toString("utf8").replace(/^\uFEFF/, "");
const manualAgentPath = path.join(
    root,
    "websoft",
    "xquery-inspector-compatibility-agent-2.js"
);
const manualAgentBytes = fs.readFileSync(manualAgentPath);
const manualAgent = manualAgentBytes.toString("utf8").replace(/^\uFEFF/, "");

verifyFileProperties();
verifyManualAgentFileProperties();
verifyRun("BigInt", 5, 0, 0);
verifyRun("bigint", 5, 0, 0);
verifyFatalFailure();

console.log("Compatibility agent smoke tests passed.");

function verifyFileProperties() {
    assert(
        agentBytes[0] === 0xef && agentBytes[1] === 0xbb && agentBytes[2] === 0xbf,
        "Compatibility agent UTF-8 BOM is missing."
    );
    assert(
        !/[\r\n]/.test(agent.replace(/\r\n/g, "")),
        "Compatibility agent contains line endings other than CRLF."
    );
    assert(
        !agent.includes("__XQI_"),
        "Compatibility agent contains an unresolved build marker."
    );
    assert(
        !/^\s*\(function\s*\(/.test(agent)
            && agent.includes("function RunXQueryInspectorCompatibilityAgent()")
            && agent.trim().endsWith("RunXQueryInspectorCompatibilityAgent();"),
        "Compatibility agent must use an explicit named entry-point call, not an IIFE."
    );
    assert(
        agent.lastIndexOf("\n    executeAgent();")
            > agent.lastIndexOf("\n    function "),
        "Compatibility agent starts before its nested helper functions are declared."
    );
    assert(
        !/\.(?:indexOf|toLowerCase|replace|substr|substring|includes|startsWith|join)\s*\(/.test(agent)
            && !/\bMath\s*\./.test(agent),
        "Compatibility agent uses JavaScript string or Math methods instead of SP-XML functions."
    );
    assert(
        !/&&|\|\||!\s*(?!=)/.test(agent),
        "Compatibility agent contains a compound or unary logical expression."
    );
    const scenariosMatch = agent.match(
        /var scenarios = ([\s\S]*?);\r?\n\s*var passed/
    );
    assert(scenariosMatch, "Generated scenarios were not found.");
    const scenarios = JSON.parse(scenariosMatch[1]);
    scenarios.forEach(function (scenario) {
        [
            "expectedFailureStage",
            "expectedParameterValue",
            "provider",
            "xquery",
            "generated"
        ].forEach(
            function (property) {
                assert(
                    Object.prototype.hasOwnProperty.call(scenario, property),
                    "Generated scenario is missing property " + property + "."
                );
            }
        );
    });
}

function verifyManualAgentFileProperties() {
    assert(
        manualAgentBytes[0] === 0xef
            && manualAgentBytes[1] === 0xbb
            && manualAgentBytes[2] === 0xbf,
        "Manual compatibility agent UTF-8 BOM is missing."
    );
    assert(
        !/[^\r]\n/.test(manualAgent),
        "Manual compatibility agent contains line endings other than CRLF."
    );
    assert(
        manualAgent.includes("function RunXQueryInspectorManualChecks()")
            && manualAgent.trim().endsWith("RunXQueryInspectorManualChecks();"),
        "Manual compatibility agent has no explicit entry point."
    );
    assert(
        manualAgent.includes("StrCharCount(boundaryXQuery) == 200000")
            && manualAgent.includes('result.failureStage == "invoke-xquery"')
            && manualAgent.includes("'unfinished"),
        "Manual compatibility agent does not validate the required boundary and parser failure."
    );
    assert(
        !/\.(?:indexOf|toLowerCase|replace|substr|substring|includes|startsWith|join)\s*\(/.test(
            manualAgent
        )
            && !/\bMath\s*\./.test(manualAgent),
        "Manual compatibility agent uses JavaScript string or Math methods instead of SP-XML functions."
    );
    assert(
        !/&&|\|\||!\s*(?!=)/.test(manualAgent),
        "Manual compatibility agent contains a compound or unary logical expression."
    );
}

function verifyRun(parameterType, expectedPassed, expectedFailed, expectedSkipped) {
    const calls = [];
    const harness = executeAgent(createInspector(parameterType, calls));

    assert(
        harness.enableCalls.length === 2
            && harness.enableCalls[0] === "xquery_inspector_compatibility:true"
            && harness.enableCalls[1] === "xquery_inspector_compatibility:false",
        "Dedicated log was not enabled and disabled exactly once."
    );
    assert(
        harness.logs.some(line => line.includes(
            "XQI|SUMMARY|passed=" + expectedPassed
                + "|failed=" + expectedFailed
                + "|skipped=" + expectedSkipped
        )),
        "Unexpected agent summary for parameter type " + parameterType + "."
    );
    assert(
        harness.logs.filter(line => line.includes("XQI|BEGIN|scenario=")).length
            === expectedPassed + expectedFailed,
        "Agent did not log every started scenario."
    );
    assert(
        calls.some(xquery => xquery.length === 200001),
        "Oversized boundary scenario was not generated."
    );
    assert(
        harness.logs.every(line =>
            !line.includes("select secret_value")
                && !line.includes("6148914691236517121")
                && !line.includes("6327975429225669221")
        ),
        "SQL, XQuery, or parameter values leaked into the compatibility log."
    );
    assert(
        harness.logs.some(line => line.includes(
            "XQI|ENV|providerDetected="
                + (parameterType === "BigInt" ? "mssql" : "postgresql")
        )),
        "Provider was not detected from the actual command parameter type."
    );

    assert(
        harness.logs.some(line => line.includes("XQI|PASS|scenario=hierarchy-child"))
            && harness.logs.some(line => line.includes("XQI|PASS|scenario=hierarchy-self")),
        "Common hierarchy scenarios did not run."
    );
}

function verifyFatalFailure() {
    const harness = executeAgent(null);
    assert(
        harness.logs.some(line => line.includes(
            "XQI|FATAL|error=Error: Synthetic DLL loading failure."
        )),
        "Fatal DLL loading failure was not recorded."
    );
    assert(
        harness.logs.some(line => line.includes("XQI|SUMMARY|passed=0|failed=1|skipped=0")),
        "Fatal failure summary is incorrect."
    );
    assert(
        harness.enableCalls[harness.enableCalls.length - 1]
            === "xquery_inspector_compatibility:false",
        "Dedicated log remained enabled after a fatal failure."
    );
}

function executeAgent(inspector) {
    const logs = [];
    const enableCalls = [];
    const tools = {
        dotnet_host: {
            Object: {
                GetAssembly: function () {
                    if (!inspector) {
                        throw new Error("Synthetic DLL loading failure.");
                    }
                    return {
                        CreateClassObject: function () { return inspector; }
                    };
                }
            }
        },
        spxml_unibridge: {
            Object: { provider: {} }
        }
    };

    new Function(
        "tools",
        "EnableLog",
        "LogEvent",
        "ParseJson",
        "StrBegins",
        "StrContains",
        "StrLowerCase",
        "StrReplace",
        "StrCharCount",
        "StrLeftCharRange",
        "ArrayCount",
        "IsEmptyValue",
        agent
    )(
        tools,
        function (name, enabled) {
            enableCalls.push(name + ":" + enabled);
        },
        function (name, text) {
            assert(name === "xquery_inspector_compatibility", "Unexpected log name.");
            logs.push(text);
        },
        JSON.parse,
        function (value, prefix, ignoreCase) {
            value = String(value);
            prefix = String(prefix);
            if (ignoreCase) {
                value = value.toLowerCase();
                prefix = prefix.toLowerCase();
            }
            return value.startsWith(prefix);
        },
        function (value, part, ignoreCase) {
            value = String(value);
            part = String(part);
            if (ignoreCase) {
                value = value.toLowerCase();
                part = part.toLowerCase();
            }
            return value.includes(part);
        },
        function (value) { return String(value).toLowerCase(); },
        function (value, search, replacement) {
            return String(value).split(search).join(replacement);
        },
        function (value) { return Array.from(String(value)).length; },
        function (value, length) { return Array.from(String(value)).slice(0, length).join(""); },
        function (value) { return value.length; },
        function (value) {
            if (value !== null && typeof value === "object") {
                return true;
            }
            return value === undefined || value === null || value === "";
        }
    );

    return { logs, enableCalls };
}

function createInspector(parameterType, calls) {
    return {
        Describe: function () {
            return parameterType === "BigInt"
                ? "Synthetic.MssqlProvider, Synthetic"
                : "Synthetic.PostgresqlProvider, Synthetic";
        },
        Inspect: function (provider, xquery) {
            calls.push(xquery);
            if (xquery.length === 200001) {
                return result({
                    success: false,
                    failureStage: "validate-input",
                    errorType: "System.ArgumentException"
                });
            }
            if (xquery.includes("IsHierChild($elem/id, 1 return $elem")) {
                return result({
                    success: false,
                    failureStage: "preprocess-xquery",
                    errorType: "System.FormatException"
                });
            }
            if (xquery.includes("IsHierChild")) {
                return result({
                    success: true,
                    sql: "select secret_value from subdivisions where id=@p0",
                    countSql: "select count(*) from subdivisions",
                    effectiveXQuery: xquery
                        .replace(/where IsHierChild(?:OrSelf)?\([^\n]+\)\n/, "")
                        .replace("/Hier()", "/Hier(6327975429225669221,'-')"),
                    reflectionPath: "collection.dc.Query.command",
                    parameters: [{ name: "@p0", type: parameterType, value: "6327975429225669221" }]
                });
            }
            return result({
                success: true,
                sql: "select secret_value from collaborators where id=@p0",
                countSql: "select count(*) from collaborators",
                effectiveXQuery: xquery,
                reflectionPath: "collection.dc.Query.command",
                parameters: [{ name: "@p0", type: parameterType, value: "6148914691236517121" }]
            });
        }
    };
}

function result(overrides) {
    return JSON.stringify(Object.assign({
        contractVersion: 1,
        inspectorVersion: "1.3.1",
        providerType: "Synthetic.Provider, Synthetic",
        providerAssemblyVersion: "1.25.3.4",
        collectionAssemblyVersion: "1.25.3.4",
        innerCollectionAssemblyVersion: "1.25.3.4",
        queryRuntimeType: "Synthetic.Query, Synthetic",
        queryAssemblyVersion: "1.25.3.4",
        cleanupError: null,
        timingsMs: {
            total: 1.25,
            translation: 0.5,
            extraction: 0.25,
            cleanup: 0.05
        },
        parameters: []
    }, overrides));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
