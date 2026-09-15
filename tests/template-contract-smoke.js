"use strict";

const fs = require("fs");
const path = require("path");

const templatePath = path.join(
    __dirname,
    "..",
    "websoft",
    "websoft-xquery-inspector.html"
);
const templateBytes = fs.readFileSync(templatePath);
const template = templateBytes.toString("utf8");
const scriptSourcePath = path.join(
    __dirname,
    "..",
    "websoft",
    "src",
    "client.js"
);
const script = fs.readFileSync(scriptSourcePath, "utf8")
    .replace(/\r\n?/g, "\n");
const styles = fs.readFileSync(path.join(
    __dirname,
    "..",
    "websoft",
    "src",
    "styles.css"
), "utf8").replace(/\r\n?/g, "\n");
const scriptStart = template.lastIndexOf("<script>");
const scriptEnd = template.lastIndexOf("</script>");

assert(scriptStart >= 0 && scriptEnd > scriptStart, "Client script was not found.");
assert(
    template.slice(scriptStart + "<script>".length, scriptEnd)
        === "\r\n" + script.replace(/\n/g, "\r\n") + "    ",
    "Generated client script does not match websoft/src/client.js."
);
new Function(script);

const clientApi = createClientApi();
const getContractState = clientApi.getContractState;
const effectiveXQuery = clientApi.effectiveXQuery;
const resultCards = clientApi.resultCards;
const resultViewModel = clientApi.resultViewModel;
const inspectionSqlWarningText = clientApi.inspectionSqlWarningText;

assert(getContractState({ contractVersion: 1 }) === "supported", "Contract 1 was rejected.");
assert(getContractState({ success: true }) === "legacy", "Legacy response was rejected.");
assert(getContractState({ contractVersion: 2 }) === "unsupported", "Unknown contract was accepted.");
assert(getContractState(null) === "unsupported", "Invalid response was accepted.");
assert(
    resultViewModel({ contractVersion: 1, success: true }).state === "result"
        && resultViewModel({ contractVersion: 1, success: false }).state === "error"
        && resultViewModel({ contractVersion: 2, success: true }).statusText
            === "Несовместимый контракт",
    "Contract response adaptation is incorrect."
);
assert(
    resultViewModel({ contractVersion: 1, operation: "execute", success: true }).statusText
        === "Выполнен успешно"
        && resultViewModel({ contractVersion: 1, operation: "execute", success: false }).statusText
            === "Выполнен с ошибкой",
    "Execution status adaptation is incorrect."
);
assert(
    effectiveXQuery({ effectiveXQuery: "prepared", xQuery: "source" }) === "prepared",
    "Effective XQuery was not selected."
);
assert(
    effectiveXQuery({ effectiveXQuery: null, xQuery: "legacy" }) === "legacy"
        && effectiveXQuery({ xQuery: "legacy" }) === "legacy",
    "Legacy XQuery fallback is incorrect."
);

verifyResultCards(resultCards);
assert(
    inspectionSqlWarningText({ sqlOffset: true, pageSize: 400 }).includes("400 записей")
        && inspectionSqlWarningText({ sqlOffset: true, pageSize: 400 }).includes("сортировку")
        && inspectionSqlWarningText({ sqlOffset: true, pageSize: 400 }).includes("пагинацию")
        && inspectionSqlWarningText({ sqlOffset: true, pageSize: 400 }).includes("Выполнение"),
    "SqlOffset warning does not explain runtime SQL changes and page size."
);
assert(
    inspectionSqlWarningText({ sqlOffset: true, pageSize: null }).includes("400 записей"),
    "SqlOffset warning does not provide the usual page size fallback."
);
assert(
    !inspectionSqlWarningText({ sqlOffset: false }).includes("пагинацию")
        && inspectionSqlWarningText({ sqlOffset: false }).includes("Предварительный SQL"),
    "Ordinary preliminary SQL warning mentions disabled pagination."
);
verifyTemplateFileProperties();

const xQueryCharacterCount = clientApi.xQueryCharacterCount;
const xQueryValidationMessage = clientApi.xQueryValidationMessage;
assert(xQueryCharacterCount("AЯ😀") === 3, "Unicode character count is incorrect.");
assert(xQueryValidationMessage("") !== "", "Empty XQuery was accepted.");
assert(
    xQueryValidationMessage("😀".repeat(200000)) === "",
    "XQuery at the character limit was rejected."
);
assert(
    xQueryValidationMessage("😀".repeat(200001)).includes("200000"),
    "Oversized XQuery was accepted or reported with the wrong limit."
);

const formatXQuery = clientApi.formatXQuery;
const formatSql = clientApi.formatSql;
const simpleXQuery = "for $x in /items let $y := $x/name where $y order by $y return $y";
const formattedSimpleXQuery = [
    "for $x in /items",
    "let $y := $x/name",
    "where $y",
    "order by $y",
    "return $y"
].join("\n");
assert(
    formatXQuery(simpleXQuery) === formattedSimpleXQuery,
    "Ordinary XQuery formatting changed."
);

const singleQuotedLiteral = "'a\n  for b\n\n return c'";
const doubleQuotedLiteral = '"d\n  let e\n\n where f"';
const literalXQuery = "for $x in " + singleQuotedLiteral
    + " let $y := " + doubleQuotedLiteral + " return $x";
const formattedLiteralXQuery = formatXQuery(literalXQuery);
assert(
    formattedLiteralXQuery === "for $x in " + singleQuotedLiteral
        + "\nlet $y := " + doubleQuotedLiteral + "\nreturn $x",
    "Multiline XQuery literals were modified."
);

const nestedComment = "(: outer\n  for untouched\n\n (: inner return :)\n  let untouched\n:)";
const commentXQuery = "for $x in /items " + nestedComment + " return $x";
const simpleComment = "(: where and return stay here :)";
assert(
    formatXQuery("for $x in /items " + simpleComment + " return $x")
        === "for $x in /items " + simpleComment + "\nreturn $x",
    "Simple XQuery comment was modified."
);
assert(
    formatXQuery(commentXQuery) === "for $x in /items " + nestedComment + "\nreturn $x",
    "Nested XQuery comment was modified."
);
assert(
    formatXQuery(formattedSimpleXQuery) === formattedSimpleXQuery
        && formatXQuery(formattedLiteralXQuery) === formattedLiteralXQuery
        && formatXQuery(formatXQuery(commentXQuery)) === formatXQuery(commentXQuery),
    "XQuery formatting is not idempotent."
);
assert(formatXQuery("") === "", "Empty XQuery changed.");
assert(
    formatXQuery("for $x return $x") === "for $x\nreturn $x",
    "XQuery formatter did not preserve the no-trailing-newline contract."
);
assert(
    formatSql("select 1 -- from ignored\nfrom dual /* where ignored */")
        === "select 1 -- from ignored\nfrom dual /* where ignored */",
    "SQL comments were modified by keyword formatting."
);

const parametersTsv = clientApi.parametersTsv;
assert(
    parametersTsv([{ name: "@p\t0", type: "String", value: "a\nb" }])
        === "Имя\tТип\tЗначение\n@p\\t0\tString\ta\\nb",
    "Parameter TSV escaping is incorrect."
);
assert(
    parametersTsv([{ name: null, type: "Object", value: { nested: true } }])
        === 'Имя\tТип\tЗначение\n\tObject\t{"nested":true}',
    "Parameter TSV value conversion is incorrect."
);

const technicalDiagnosticSections = clientApi.technicalDiagnosticSections;
const technicalDiagnosticLines = clientApi.technicalDiagnosticLines;
const millisecondsText = clientApi.millisecondsText;
const diagnosticData = {
    contractVersion: 1,
    inspectorVersion: "1.2.1",
    success: true,
    failureStage: null,
    timingsMs: { total: 4 }
};
const diagnosticSections = technicalDiagnosticSections({
    inspect: {
        type: "result",
        viewModel: { data: diagnosticData }
    },
    execute: null
}, false);
const lines = technicalDiagnosticLines(diagnosticSections);
assert(lines.includes("Версия контракта: 1"), "Contract diagnostic is incorrect.");
assert(
    lines.includes("Этап ошибки: —"),
    "Missing diagnostic value does not use the fallback."
);
const mergedEnvironment = technicalDiagnosticSections({
    inspect: {
        type: "result",
        viewModel: { data: { providerType: "CompleteProvider" } }
    },
    execute: {
        type: "result",
        viewModel: { data: { providerType: null, success: false } }
    }
}, false)[0];
assert(
    mergedEnvironment.items.some(function (item) {
        return item[0] === "Тип провайдера" && item[1] === "CompleteProvider";
    }),
    "Sparse execution diagnostics hid complete inspection environment data."
);
assert(millisecondsText(null) === "—", "Null timing does not use the fallback.");
assert(millisecondsText(undefined) === "—", "Missing timing does not use the fallback.");

const elementDocument = createElementDocument();
const htmlLikeValue = '<img src=x onerror="alert(1)">';
const safeCard = clientApi.errorCard(
    "Diagnostic", htmlLikeValue, { document: elementDocument }
);
assert(
    safeCard.children[1].textContent === htmlLikeValue,
    "HTML-like diagnostic value was not preserved as text."
);

verifyAsyncBehavior().then(function () {
    console.log("Template contract smoke tests passed.");
}, function (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});

async function verifyAsyncBehavior() {
    await verifyTransportBehavior();
    await verifyRendererAndInstanceIsolation();
    await verifyCopyBehavior();
}

async function verifyTransportBehavior() {
    let requestedUrl;
    let requestedOptions;
    let transport = clientApi.createTransport(function (url, options) {
        requestedUrl = url;
        requestedOptions = options;
        return Promise.resolve(response(true, 200, '{"contractVersion":1,"success":true}'));
    }, "/inspect");
    const result = await transport.request("inspect", "for $x return $x");
    assert(result.success === true, "Transport did not parse a successful response.");
    assert(requestedUrl === "/inspect", "Transport changed the endpoint.");
    assert(
        requestedOptions.body === "action=inspect&xquery=for%20%24x%20return%20%24x",
        "Transport changed the request body."
    );
    await transport.request("execute", "for $x return $x");
    assert(
        requestedOptions.body === "action=execute&xquery=for%20%24x%20return%20%24x",
        "Transport did not send the execution action."
    );

    transport = clientApi.createTransport(function () {
        return Promise.resolve(response(false, 500, "server failed"));
    }, "/inspect");
    await assertRejects(
        transport.request("execute", "secret request"),
        "server failed",
        "Transport error response changed."
    );

    transport = clientApi.createTransport(function () {
        return Promise.resolve(response(true, 200, "<html>portal</html>"));
    }, "/inspect");
    await assertRejects(
        transport.request("inspect", "secret request"),
        "Сервер вернул HTML вместо JSON",
        "HTML transport response was not rejected."
    );
}

async function verifyRendererAndInstanceIsolation() {
    const harness = createDomHarness();
    const first = harness.createRoot("first");
    const second = harness.createRoot("second");
    let firstFetchCount = 0;
    let secondFetchCount = 0;
    const firstApp = clientApi.initialize(first.root, function () {
        firstFetchCount += 1;
        return Promise.resolve(response(
            true,
            200,
            '{"contractVersion":1,"success":true,"sql":"select first","parameters":[]}'
        ));
    }, function () { return 10; });
    const secondApp = clientApi.initialize(second.root, function () {
        secondFetchCount += 1;
        return Promise.resolve(response(
            true,
            200,
            '{"contractVersion":1,"success":true,"sql":"select second","parameters":[]}'
        ));
    }, function () { return 20; });

    first.nodes.editor.value = "first query";
    second.nodes.editor.value = "second query";
    await firstApp.inspect();
    assert(firstFetchCount === 1 && secondFetchCount === 0, "First instance used another transport.");
    assert(firstApp.state.status === "result", "Successful request state is incorrect.");
    assert(
        first.nodes.result.textContent.includes("select first")
            && !second.nodes.result.textContent.includes("select first"),
        "First renderer wrote outside its root."
    );

    await secondApp.inspect();
    assert(firstFetchCount === 1 && secondFetchCount === 1, "Second instance used another transport.");
    assert(
        second.nodes.result.textContent.includes("select second")
            && !first.nodes.result.textContent.includes("select second"),
        "Second renderer wrote outside its root."
    );

    const renderer = clientApi.createRenderer(clientApi.getDom(first.root));
    renderer.transportError("independent render");
    assert(
        first.nodes.result.textContent.includes("independent render")
            && firstFetchCount === 1,
        "Renderer was not independently callable."
    );

    const preservedRoot = harness.createRoot("preserved");
    const preservedApp = clientApi.initialize(preservedRoot.root, function (url, options) {
        if (options.body.indexOf("action=execute") >= 0) {
            return Promise.resolve(response(
                true,
                200,
                '{"contractVersion":1,"operation":"execute","success":true,'
                    + '"executedSql":"select executed","executedParameters":[]}'
            ));
        }
        return Promise.resolve(response(
            true,
            200,
            '{"contractVersion":1,"operation":"inspect","success":true,'
                + '"sql":"select inspected","parameters":[]}'
        ));
    }, function () { return 40; });
    preservedRoot.nodes.editor.value = "preserved query";
    await preservedApp.execute();
    assert(
        preservedRoot.nodes.result.textContent.includes("select executed"),
        "Execution result was not rendered."
    );
    await preservedApp.inspect();
    assert(
        preservedRoot.nodes.result.textContent.includes("select inspected")
            && !preservedRoot.nodes.result.textContent.includes("select executed"),
        "Inspection tab did not show its own result."
    );
    preservedRoot.nodes.executeTab.listeners.click();
    assert(
        preservedRoot.nodes.result.textContent.includes("select executed")
            && !preservedRoot.nodes.result.textContent.includes("select inspected"),
        "Inspection overwrote the saved execution result."
    );
    assert(
        preservedRoot.nodes.executeTab["aria-selected"] === "true"
            && preservedRoot.nodes.inspectTab["aria-selected"] === "false",
        "Execution result tab selection is incorrect."
    );
    assert(
        preservedRoot.nodes.technical.textContent.includes("select executed")
            && preservedRoot.nodes.technical.textContent.includes("select inspected")
            && preservedRoot.nodes.technical.textContent.includes("Среда")
            && preservedRoot.nodes.technical.textContent.includes("Инспекция")
            && preservedRoot.nodes.technical.textContent.includes("Выполнение"),
        "Common technical data did not accumulate both server responses."
    );
    preservedRoot.nodes.editor.value = "";
    await preservedApp.inspect();
    assert(
        preservedApp.state.outputs.inspect.type === "result"
            && preservedApp.state.outputs.execute.type === "result"
            && preservedRoot.nodes.technical.textContent.includes("select executed")
            && preservedRoot.nodes.technical.textContent.includes("select inspected"),
        "Client-side validation replaced accumulated server responses."
    );
    preservedRoot.nodes.editor.value = "changed query";
    preservedRoot.nodes.editor.listeners.input();
    assert(
        preservedRoot.nodes.staleBadge.hidden === false
            && preservedRoot.nodes.technical.textContent.includes("предыдущей версии XQuery"),
        "Changed XQuery did not mark technical data as stale."
    );
    await preservedApp.inspect();
    assert(
        preservedRoot.nodes.staleBadge.hidden === true
            && !preservedRoot.nodes.technical.textContent.includes("select executed")
            && preservedRoot.nodes.technical.textContent.includes("Выполнение: ещё не запускалось"),
        "A new XQuery session retained incompatible execution data."
    );

    const pendingRoot = harness.createRoot("pending");
    let pendingFetchCount = 0;
    let resolvePending;
    const pendingApp = clientApi.initialize(pendingRoot.root, function () {
        pendingFetchCount += 1;
        return new Promise(function (resolve) { resolvePending = resolve; });
    }, function () { return 30; });
    pendingRoot.nodes.editor.value = "pending query";
    const firstPending = pendingApp.inspect();
    const repeatedPending = pendingApp.inspect();
    assert(
        pendingFetchCount === 1
            && pendingApp.state.status === "loading"
            && pendingRoot.nodes.inspectButton.disabled === true,
        "Repeated request was not blocked while loading."
    );
    resolvePending(response(
        true,
        200,
        '{"contractVersion":1,"success":true,"sql":"select pending","parameters":[]}'
    ));
    await Promise.all([firstPending, repeatedPending]);
    assert(
        pendingApp.state.status === "result"
            && pendingRoot.nodes.inspectButton.disabled === false,
        "Request state did not leave loading after completion."
    );

}

async function verifyCopyBehavior() {
    const secret = "SECRET-COPY-VALUE-42";
    let harness = createCopyHarness({
        writeText: function () { return Promise.resolve(); },
        execResult: false
    });
    let button = copyTestButton("Копировать");
    let operation = harness.copyText(secret, button);
    assert(operation && typeof operation.then === "function", "copyText() did not return a promise.");
    assert(await operation === true, "Successful Clipboard API was not reported as success.");
    assert(button.textContent === "Скопировано", "Clipboard success feedback is missing.");
    assert(harness.execCalls() === 0, "Fallback ran after successful Clipboard API.");
    assert(harness.helperCount() === 0, "Successful Clipboard API left a textarea.");

    harness = createCopyHarness({
        writeText: function () { return Promise.reject(new Error(secret)); },
        execResult: true
    });
    button = copyTestButton("Копировать SQL");
    assert(await harness.copyText(secret, button) === true, "Successful fallback was rejected.");
    assert(harness.execCalls() === 1, "Fallback did not run after Clipboard API rejection.");
    assert(button.textContent === "Скопировано", "Fallback success feedback is missing.");
    assert(harness.helperCount() === 0, "Successful fallback left a textarea.");

    harness = createCopyHarness({ secure: false, execResult: false });
    button = copyTestButton("Копировать JSON");
    assert(await harness.copyText(secret, button) === false, "False fallback result was accepted.");
    assert(button.textContent === "Не скопировано", "Fallback failure feedback is missing.");
    assert(button.title.length > 0, "Fallback failure reason is not accessible.");
    assert(!button.title.includes(secret), "Fallback failure reason contains copied text.");
    assert(harness.helperCount() === 0, "Failed fallback left a textarea.");

    harness = createCopyHarness({
        secure: false,
        execError: new Error(secret)
    });
    button = copyTestButton("Копировать таблицу");
    assert(await harness.copyText(secret, button) === false, "Fallback exception was accepted.");
    assert(button.textContent === "Не скопировано", "Fallback exception feedback is missing.");
    assert(!button.title.includes(secret), "Fallback exception reason contains copied text.");
    assert(harness.helperCount() === 0, "Fallback exception left a textarea.");

    const pending = [];
    harness = createCopyHarness({
        writeText: function () {
            return new Promise(function (resolve, reject) {
                pending.push({ resolve: resolve, reject: reject });
            });
        },
        execResult: false
    });
    button = copyTestButton("Копировать");
    const first = harness.copyText("first", button);
    pending[0].resolve();
    assert(await first === true, "First rapid copy did not succeed.");
    const second = harness.copyText("second", button);
    pending[1].reject(new Error("denied"));
    assert(await second === false, "Second rapid copy did not report fallback failure.");
    assert(button.textContent === "Не скопировано", "Latest rapid-copy feedback is incorrect.");
    harness.runTimer(0);
    assert(
        button.textContent === "Не скопировано",
        "An obsolete timer restored the label after a newer attempt."
    );
    harness.runTimer(1);
    assert(button.textContent === "Копировать", "Latest timer did not restore the original label.");
}

function createCopyHarness(options) {
    const timers = [];
    const helpers = [];
    let execCalls = 0;
    const body = {
        appendChild: function (node) {
            helpers.push(node);
            node.parentNode = body;
        },
        removeChild: function (node) {
            const index = helpers.indexOf(node);
            if (index >= 0) {
                helpers.splice(index, 1);
            }
            node.parentNode = null;
        }
    };
    const document = {
        body: body,
        createElement: function (tag) {
            assert(tag === "textarea", "Copy fallback created an unexpected element.");
            return {
                value: "",
                style: {},
                parentNode: null,
                select: function () {}
            };
        },
        execCommand: function (command) {
            execCalls += 1;
            assert(command === "copy", "Copy fallback used an unexpected command.");
            if (options.execError) {
                throw options.execError;
            }
            return options.execResult;
        }
    };
    const navigator = options.writeText ? {
        clipboard: { writeText: options.writeText }
    } : {};
    const window = {
        isSecureContext: options.secure !== false,
        setTimeout: function (callback) {
            timers.push(callback);
        }
    };
    const copyText = createClientApi({
        document: document,
        navigator: navigator,
        window: window
    }).copyText;

    return {
        copyText: copyText,
        execCalls: function () { return execCalls; },
        helperCount: function () { return helpers.length; },
        runTimer: function (index) { timers[index](); }
    };
}

function copyTestButton(label) {
    return {
        textContent: label,
        title: "",
        copyLabel: label,
        copyTitle: "",
        copyAttempt: 0
    };
}

function verifyResultCards(getCards) {
    const supportedSuccess = getCards({
        contractVersion: 1,
        success: true,
        countSql: "select count(*)",
        sqlOffset: true,
        cleanupError: null
    });
    assertCardKinds(supportedSuccess, [
        "inspection-sql-warning",
        "sql",
        "parameters",
        "effective-xquery",
        "count-sql"
    ], "Successful result card order is incorrect.");
    assert(
        supportedSuccess[3].expanded === false
            && supportedSuccess[4].expanded === false,
        "Successful result card expansion state is incorrect."
    );

    const legacy = getCards({ success: true });
    assertCardKinds(legacy, [
        "legacy-warning",
        "inspection-sql-warning",
        "sql",
        "parameters",
        "effective-xquery"
    ], "Legacy result card order is incorrect.");

    const failure = getCards({ contractVersion: 1, success: false });
    assertCardKinds(
        failure,
        ["error"],
        "Failed result card order is incorrect."
    );

    const cleanupFailure = getCards({
        contractVersion: 1,
        success: false,
        cleanupError: "cleanup failed"
    });
    assertCardKinds(cleanupFailure, [
        "error",
        "cleanup-error"
    ], "Cleanup-error card order is incorrect.");

    const unsupported = getCards({
        success: true,
        contractVersion: 2
    });
    assertCardKinds(
        unsupported,
        ["contract-error"],
        "Unsupported contract card order is incorrect."
    );

    const execution = getCards({
        contractVersion: 1,
        operation: "execute",
        success: true,
        executedSql: "select id from collaborators",
        countSql: "select count(*) from collaborators",
        executedParameters: []
    });
    assertCardKinds(execution, [
        "executed-sql-warning",
        "executed-sql",
        "executed-parameters",
        "effective-xquery",
        "execution-count-sql"
    ], "Execution result card order is incorrect.");

    const executionFailure = getCards({
        contractVersion: 1,
        operation: "execute",
        success: false,
        sql: "select broken",
        parameters: [],
        error: "database failed"
    });
    assertCardKinds(executionFailure, [
        "sql",
        "parameters",
        "error",
        "effective-xquery"
    ], "Execution failure card order is incorrect.");

    const obsoleteAssessments = getCards({
        contractVersion: 1,
        success: true,
        sqlAssessment: { warnings: [{ source: "sql" }] },
        countSqlAssessment: { warnings: [{ source: "countSql" }] }
    });
    assertCardKinds(obsoleteAssessments, [
        "inspection-sql-warning",
        "sql",
        "parameters",
        "effective-xquery"
    ], "Obsolete SQL assessments still affect the client.");
}

function assertCardKinds(cards, expectedKinds, message) {
    const actualKinds = cards.map(card => card.kind);
    assert(JSON.stringify(actualKinds) === JSON.stringify(expectedKinds), message);
}

function verifyTemplateFileProperties() {
    const markup = template.slice(0, scriptStart)
        + template.slice(scriptEnd + "</script>".length);
    assert(
        templateBytes[0] === 0xef
            && templateBytes[1] === 0xbb
            && templateBytes[2] === 0xbf,
        "Template UTF-8 BOM is missing."
    );
    assert(
        !/[\r\n]/.test(template.replace(/\r\n/g, "")),
        "Template contains line endings other than CRLF."
    );
    assert(
        !/<\/?(?:html|head|body)\b/i.test(markup),
        "Template contains a page wrapper."
    );
    assert(!/\blocalStorage\b/.test(template), "Template persists diagnostic data.");
    assert(!/\bLogEvent\b|\bconsole\s*\./.test(template), "Template logs diagnostic data.");
    assert(!/https?:\/\//i.test(template), "Template contains an external URL.");
    assert(
        !/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\s*\(|\beval\s*\(/
            .test(template),
        "Template uses a dangerous HTML API."
    );
    assert(
        !/document\.querySelector(?:All)?\s*\(/.test(script),
        "Client performs a DOM query outside its root."
    );

    const transportSource = sourceBetween(
        script,
        "function createTransport(fetchImplementation, endpoint)",
        "// Contract adaptation"
    );
    const rendererSource = sourceBetween(
        script,
        "function createRenderer(dom)",
        "function renderResultCard(card, data, dom)"
    );
    assert(
        !/\b(?:document|querySelector|textContent|appendChild)\b/.test(transportSource),
        "Transport accesses the DOM."
    );
    assert(!/\bfetch\s*\(/.test(rendererSource), "Renderer performs a fetch.");

    const cssSections = [
        "/* Tokens and root */",
        "/* Layout */",
        "/* Controls */",
        "/* Editor */",
        "/* Result */",
        "/* Cards, tables and details */",
        "/* Responsive */",
        "/* Reduced motion */"
    ];
    let previousSection = -1;
    cssSections.forEach(function (section) {
        const position = styles.indexOf(section);
        assert(position > previousSection, "CSS sections are missing or out of order: " + section);
        previousSection = position;
    });
}

function createElementDocument() {
    const document = {
        createElement: function (tag) {
            const node = createTestNode(tag);
            node.ownerDocument = document;
            return node;
        }
    };
    return document;
}

function createClientApi(options) {
    options = options || {};
    const initialization = [
        "initialize(document.currentScript.parentNode, fetch, function () {",
        "                return performance.now();",
        "            });"
    ].join("\n");
    const exported = [
        "config", "initialize", "getDom", "createTransport", "createRenderer",
        "resultViewModel", "getContractState", "effectiveXQuery", "resultCards",
        "inspectionSqlWarningText",
        "xQueryCharacterCount", "xQueryValidationMessage", "parametersTsv",
        "technicalDiagnosticSections", "technicalDiagnosticLines",
        "millisecondsText", "errorCard", "copyText",
        "formatXQuery", "formatSql"
    ].map(function (name) {
        return name + ": " + name;
    }).join(", ");
    const testable = script
        .replace("        (function () {", "        return (function () {")
        .replace(initialization, "return { " + exported + " };");
    const document = options.document || {
        currentScript: { parentNode: null },
        createElement: function (tag) { return createTestNode(tag); },
        body: createTestNode("body"),
        execCommand: function () { return false; }
    };
    const window = options.window || {
        isSecureContext: false,
        setTimeout: function () {}
    };
    const navigator = options.navigator || {};
    return new Function(
        "document",
        "fetch",
        "performance",
        "navigator",
        "window",
        testable
    )(
        document,
        function () { throw new Error("Unexpected fetch."); },
        { now: function () { return 0; } },
        navigator,
        window
    );
}

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert(start >= 0 && end > start, startMarker + " was not found.");
    return source.slice(start, end);
}

function response(ok, status, text) {
    return {
        ok: ok,
        status: status,
        text: function () { return Promise.resolve(text); }
    };
}

async function assertRejects(operation, expectedText, message) {
    let actual = "";
    try {
        await operation;
    } catch (error) {
        actual = error && error.message ? error.message : String(error);
    }
    assert(actual.includes(expectedText), message);
}

function createDomHarness() {
    const document = createElementDocument();

    function createRoot(name) {
        const nodes = {
            editor: createTestNode("textarea"),
            lineNumbers: createTestNode("div"),
            inspectButton: createTestNode("button"),
            inspectButtonLabel: createTestNode("span"),
            executeButton: createTestNode("button"),
            executeButtonLabel: createTestNode("span"),
            inspectTab: createTestNode("button"),
            executeTab: createTestNode("button"),
            result: createTestNode("div"),
            resultStatus: createTestNode("div"),
            technical: createTestNode("div"),
            staleBadge: createTestNode("span"),
            formatButton: createTestNode("button"),
            sampleButton: createTestNode("button"),
            clearButton: createTestNode("button")
        };
        const selectors = {
            "#xqi-editor": nodes.editor,
            "#xqi-line-numbers": nodes.lineNumbers,
            "#xqi-inspect-button": nodes.inspectButton,
            "#xqi-inspect-button-label": nodes.inspectButtonLabel,
            "#xqi-execute-button": nodes.executeButton,
            "#xqi-execute-button-label": nodes.executeButtonLabel,
            "#xqi-inspect-tab": nodes.inspectTab,
            "#xqi-execute-tab": nodes.executeTab,
            "#xqi-result": nodes.result,
            "#xqi-result-status": nodes.resultStatus,
            "#xqi-technical": nodes.technical,
            "#xqi-stale-badge": nodes.staleBadge,
            "#xqi-format-button": nodes.formatButton,
            "#xqi-sample-button": nodes.sampleButton,
            "#xqi-clear-button": nodes.clearButton
        };
        nodes.inspectButton.appendChild(nodes.inspectButtonLabel);
        nodes.executeButton.appendChild(nodes.executeButtonLabel);
        nodes.editor.focus = function () { nodes.editor.focused = true; };
        const root = createTestNode("div");
        root.name = name;
        root.ownerDocument = document;
        root.querySelector = function (selector) {
            assert(selectors[selector], "Unexpected root selector: " + selector);
            return selectors[selector];
        };
        return { root: root, nodes: nodes };
    }

    return { createRoot: createRoot };
}

function createTestNode(tag) {
    const node = {
        tagName: tag,
        className: "",
        children: [],
        listeners: {},
        parentNode: null,
        style: {},
        appendChild: function (child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        insertBefore: function (child, before) {
            const index = this.children.indexOf(before);
            child.parentNode = this;
            this.children.splice(index < 0 ? this.children.length : index, 0, child);
        },
        remove: function () {
            if (this.parentNode) {
                const index = this.parentNode.children.indexOf(this);
                if (index >= 0) {
                    this.parentNode.children.splice(index, 1);
                }
                this.parentNode = null;
            }
        },
        addEventListener: function (type, listener) {
            this.listeners[type] = listener;
        },
        setAttribute: function (name, value) {
            this[name] = value;
        },
        scrollIntoView: function () {
            this.scrolled = true;
        },
        querySelector: function (selector) {
            if (selector === ".spinner") {
                return this.children.find(function (child) {
                    return child.className === "spinner";
                }) || null;
            }
            return null;
        }
    };
    let ownText = "";
    Object.defineProperty(node, "textContent", {
        get: function () {
            return ownText + this.children.map(function (child) {
                return child.textContent;
            }).join("");
        },
        set: function (value) {
            ownText = String(value);
            this.children = [];
        }
    });
    return node;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
