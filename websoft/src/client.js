        (function () {
            "use strict";

            // Configuration and initialization
            var config = {
                sample: [
                    "for $elem in collaborators",
                    "where $elem/id = 6148914691236517121",
                    "return $elem/Fields('id', 'fullname')"
                ].join("\n"),
                supportedContractVersion: 1,
                maxXQueryLength: 200000,
                inspectEndpoint:
                    "/custom_web_template.html" +
                    "?object_code=websoft-xquery-inspector" +
                    "&content_type=application%2Fjson%3B%20charset%3Dutf-8"
            };

            initialize(document.currentScript.parentNode, fetch, function () {
                return performance.now();
            });

            function initialize(root, fetchImplementation, now) {
                var dom = getDom(root);
                var state = {
                    status: "idle",
                    activeOperation: "inspect",
                    sessionXQuery: null,
                    outputs: { inspect: null, execute: null }
                };
                var transport = createTransport(fetchImplementation, config.inspectEndpoint);
                var render = createRenderer(dom);

                function refreshTechnical() {
                    render.technical(
                        state.outputs,
                        state.sessionXQuery !== null
                            && dom.editor.value.trim() !== state.sessionXQuery
                    );
                }

                function showOutput(operation) {
                    var output;
                    state.activeOperation = operation;
                    render.selectOperation(operation);
                    output = state.outputs[operation];
                    if (!output) {
                        render.empty(operation);
                    } else if (output.type === "result") {
                        render.result(output.viewModel, output.elapsed);
                    } else {
                        render.transportError(output.message);
                    }
                    refreshTechnical();
                }

                function showCurrentOutput() {
                    showOutput(state.activeOperation);
                }

                function run(operation) {
                    var xquery;
                    var validationMessage;
                    var startedAt;

                    if (state.status === "loading") {
                        return Promise.resolve();
                    }

                    xquery = dom.editor.value.trim();
                    validationMessage = xQueryValidationMessage(xquery);
                    if (validationMessage) {
                        state.status = "error";
                        state.activeOperation = operation;
                        render.selectOperation(operation);
                        render.transportError(validationMessage);
                        refreshTechnical();
                        dom.editor.focus();
                        return Promise.resolve();
                    }

                    if (state.sessionXQuery !== xquery) {
                        state.sessionXQuery = xquery;
                        state.outputs = { inspect: null, execute: null };
                    }

                    state.status = "loading";
                    state.activeOperation = operation;
                    render.selectOperation(operation);
                    render.pending(operation);
                    render.technical(state.outputs, false);
                    render.loading(true, operation);
                    startedAt = now();

                    return transport.request(operation, xquery).then(function (data) {
                        var viewModel = resultViewModel(data);
                        state.status = viewModel.state;
                        state.outputs[operation] = {
                            type: "result",
                            viewModel: viewModel,
                            elapsed: now() - startedAt
                        };
                        if (state.activeOperation === operation) {
                            showCurrentOutput();
                        }
                    }, function (error) {
                        state.status = "error";
                        state.outputs[operation] = {
                            type: "error",
                            message: error && error.message ? error.message : String(error)
                        };
                        if (state.activeOperation === operation) {
                            showCurrentOutput();
                        }
                    }).then(function () {
                        render.loading(false, operation);
                    }, function (error) {
                        state.status = "error";
                        render.loading(false, operation);
                        state.outputs[operation] = {
                            type: "error",
                            message: error && error.message ? error.message : String(error)
                        };
                        if (state.activeOperation === operation) {
                            showCurrentOutput();
                        }
                    });
                }

                function inspect() {
                    return run("inspect");
                }

                function execute() {
                    return run("execute");
                }

                bindEditor(dom, inspect, execute, showOutput, refreshTechnical);
                dom.editor.value = config.sample;
                updateLineNumbers(dom);
                showOutput("inspect");

                return {
                    inspect: inspect,
                    execute: execute,
                    showOutput: showOutput,
                    state: state
                };
            }

            function getDom(root) {
                return {
                    document: root.ownerDocument,
                    editor: root.querySelector("#xqi-editor"),
                    lineNumbers: root.querySelector("#xqi-line-numbers"),
                    inspectButton: root.querySelector("#xqi-inspect-button"),
                    inspectButtonLabel: root.querySelector("#xqi-inspect-button-label"),
                    executeButton: root.querySelector("#xqi-execute-button"),
                    executeButtonLabel: root.querySelector("#xqi-execute-button-label"),
                    inspectTab: root.querySelector("#xqi-inspect-tab"),
                    executeTab: root.querySelector("#xqi-execute-tab"),
                    resultNode: root.querySelector("#xqi-result"),
                    resultStatusNode: root.querySelector("#xqi-result-status"),
                    technicalNode: root.querySelector("#xqi-technical"),
                    staleBadge: root.querySelector("#xqi-stale-badge"),
                    formatButton: root.querySelector("#xqi-format-button"),
                    sampleButton: root.querySelector("#xqi-sample-button"),
                    clearButton: root.querySelector("#xqi-clear-button")
                };
            }

            // Request state and editor
            function bindEditor(dom, inspect, execute, showOutput, refreshTechnical) {
                dom.editor.addEventListener("input", function () {
                    updateLineNumbers(dom);
                    refreshTechnical();
                });
                dom.editor.addEventListener("scroll", function () {
                    dom.lineNumbers.scrollTop = dom.editor.scrollTop;
                });
                dom.editor.addEventListener("keydown", function (event) {
                    handleEditorKeydown(event, dom);
                });
                dom.inspectButton.addEventListener("click", inspect);
                dom.executeButton.addEventListener("click", execute);
                dom.inspectTab.addEventListener("click", function () {
                    showOutput("inspect");
                });
                dom.executeTab.addEventListener("click", function () {
                    showOutput("execute");
                });
                dom.formatButton.addEventListener("click", function () {
                    dom.editor.value = formatXQuery(dom.editor.value);
                    updateLineNumbers(dom);
                    refreshTechnical();
                    dom.editor.focus();
                });
                dom.sampleButton.addEventListener("click", function () {
                    dom.editor.value = config.sample;
                    updateLineNumbers(dom);
                    refreshTechnical();
                    dom.editor.focus();
                });
                dom.clearButton.addEventListener("click", function () {
                    dom.editor.value = "";
                    updateLineNumbers(dom);
                    refreshTechnical();
                    dom.editor.focus();
                });

            }

            function handleEditorKeydown(event, dom) {
                if (event.key === "Tab") {
                    event.preventDefault();
                    var start = dom.editor.selectionStart;
                    var end = dom.editor.selectionEnd;
                    dom.editor.value = dom.editor.value.slice(0, start)
                        + "    " + dom.editor.value.slice(end);
                    dom.editor.selectionStart = dom.editor.selectionEnd = start + 4;
                    updateLineNumbers(dom);
                }
            }

            function updateLineNumbers(dom) {
                var count = dom.editor.value.split("\n").length;
                var numbers = [];
                var index;
                for (index = 1; index <= count; index += 1) {
                    numbers.push(index);
                }
                dom.lineNumbers.textContent = numbers.join("\n");
            }

            function xQueryCharacterCount(source) {
                return Array.from(source).length;
            }

            function xQueryValidationMessage(xquery) {
                if (!xquery) {
                    return "Введите XQuery.";
                }
                if (xQueryCharacterCount(xquery) > config.maxXQueryLength) {
                    return "XQuery превышает ограничение "
                        + config.maxXQueryLength + " символов.";
                }
                return "";
            }

            // Transport
            function createTransport(fetchImplementation, endpoint) {
                function request(action, xquery) {
                    return fetchImplementation(endpoint, {
                        method: "POST",
                        credentials: "same-origin",
                        headers: {
                            "Accept": "application/json",
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest"
                        },
                        body: "action=" + encodeURIComponent(action)
                            + "&xquery=" + encodeURIComponent(xquery)
                    }).then(function (response) {
                        return response.text().then(function (responseText) {
                            if (!response.ok) {
                                throw new Error(responseText || ("HTTP " + response.status));
                            }
                            if (/^\s*(?:<!doctype|<html)/i.test(responseText)) {
                                throw new Error(
                                    "Сервер вернул HTML вместо JSON. Проверьте код " +
                                    "настраиваемого шаблона и его прямой endpoint."
                                );
                            }
                            try {
                                return JSON.parse(responseText);
                            } catch (parseError) {
                                throw new Error("Сервер вернул не JSON: " + responseText);
                            }
                        });
                    });
                }

                return { request: request };
            }

            // Contract adaptation
            function resultViewModel(data) {
                var contractState = getContractState(data);
                if (contractState === "unsupported") {
                    return {
                        state: "error",
                        statusText: "Несовместимый контракт",
                        statusClass: "status-error",
                        data: data,
                        cards: resultCards(data)
                    };
                }

                var execute = data.operation === "execute";
                return {
                    state: data.success ? "result" : "error",
                    statusText: execute
                        ? (data.success ? "Выполнен успешно" : "Выполнен с ошибкой")
                        : (data.success ? "SQL сформирован" : "Ошибка инспекции"),
                    statusClass: data.success ? "status-success" : "status-error",
                    data: data,
                    cards: resultCards(data)
                };
            }

            function getContractState(data) {
                if (!data || typeof data !== "object") {
                    return "unsupported";
                }
                if (!Object.prototype.hasOwnProperty.call(data, "contractVersion")) {
                    return "legacy";
                }
                return data.contractVersion === config.supportedContractVersion
                    ? "supported"
                    : "unsupported";
            }

            function effectiveXQuery(data) {
                if (data.effectiveXQuery === null || data.effectiveXQuery === undefined) {
                    return data.xQuery || "";
                }
                return data.effectiveXQuery;
            }

            function resultCards(data) {
                var cards = [];
                var contractState = getContractState(data);
                if (contractState === "unsupported") {
                    return [{ kind: "contract-error" }];
                }
                if (contractState === "legacy") {
                    cards.push({ kind: "legacy-warning" });
                }
                if (data.operation === "execute") {
                    if (data.executedSql) {
                        cards.push({ kind: "executed-sql-warning" });
                        cards.push({ kind: "executed-sql" });
                        cards.push({ kind: "executed-parameters" });
                    } else if (data.sql) {
                        cards.push({ kind: "sql" });
                        cards.push({ kind: "parameters" });
                    }
                    if (!data.success && data.error) {
                        cards.push({ kind: "error" });
                    }
                    if (data.executedCommandCaptureError) {
                        cards.push({ kind: "executed-command-capture-error" });
                    }
                    cards.push({ kind: "effective-xquery", expanded: false });
                    if (data.countSql) {
                        cards.push({ kind: "execution-count-sql", expanded: false });
                    }
                    if (data.cleanupError) {
                        cards.push({ kind: "cleanup-error" });
                    }
                    return cards;
                }
                if (data.success) {
                    cards.push({ kind: "inspection-sql-warning" });
                    cards.push({ kind: "sql" });
                    cards.push({ kind: "parameters" });
                    cards.push({ kind: "effective-xquery", expanded: false });
                    if (data.countSql) {
                        cards.push({ kind: "count-sql", expanded: false });
                    }
                } else {
                    cards.push({ kind: "error" });
                }
                if (data.cleanupError) {
                    cards.push({ kind: "cleanup-error" });
                }
                return cards;
            }

            // Result rendering
            function createRenderer(dom) {
                function selectOperation(operation) {
                    var inspectActive = operation === "inspect";
                    dom.inspectTab.className = "result-tab" + (inspectActive ? " is-active" : "");
                    dom.executeTab.className = "result-tab" + (inspectActive ? "" : " is-active");
                    dom.inspectTab.setAttribute("aria-selected", inspectActive ? "true" : "false");
                    dom.executeTab.setAttribute("aria-selected", inspectActive ? "false" : "true");
                }

                function renderEmpty(operation) {
                    var empty = element(dom.document, "div", "empty-state");
                    dom.resultNode.textContent = "";
                    dom.resultStatusNode.textContent = "";
                    empty.appendChild(element(
                        dom.document,
                        "div",
                        "empty-icon",
                        operation === "execute" ? "2" : "1"
                    ));
                    empty.appendChild(element(
                        dom.document,
                        "strong",
                        "",
                        operation === "execute"
                            ? "Запрос ещё не выполнялся"
                            : "Инспекция ещё не запускалась"
                    ));
                    empty.appendChild(element(
                        dom.document,
                        "span",
                        "",
                        operation === "execute"
                            ? "Нажмите «Выполнить», чтобы запустить запрос и получить наблюдаемый SQL выполнения."
                            : "Нажмите «Инспектировать», чтобы получить предварительный SQL без выполнения запроса."
                    ));
                    dom.resultNode.appendChild(empty);
                }

                function renderPending(operation) {
                    dom.resultNode.textContent = "";
                    setResultStatus(
                        operation === "execute" ? "Выполнение…" : "Инспекция…",
                        "status-pending",
                        undefined,
                        dom
                    );
                    dom.resultNode.appendChild(element(
                        dom.document,
                        "div",
                        "pending-state",
                        operation === "execute"
                            ? "Запрос выполняется. Результирующие строки не сохраняются."
                            : "Формируется предварительный SQL."
                    ));
                }

                function setLoading(loading, operation) {
                    var activeButton = operation === "execute"
                        ? dom.executeButton : dom.inspectButton;
                    var activeLabel = operation === "execute"
                        ? dom.executeButtonLabel : dom.inspectButtonLabel;
                    var oldSpinner = activeButton.querySelector(".spinner");
                    dom.inspectButton.disabled = loading;
                    dom.executeButton.disabled = loading;
                    activeLabel.textContent = loading
                        ? (operation === "execute" ? "Выполнение…" : "Инспекция…")
                        : (operation === "execute" ? "Выполнить" : "Инспектировать");

                    if (loading && !oldSpinner) {
                        var spinner = element(dom.document, "span", "spinner");
                        spinner.setAttribute("aria-hidden", "true");
                        activeButton.insertBefore(spinner, activeLabel);
                    } else if (!loading && oldSpinner) {
                        oldSpinner.remove();
                    }
                }

                function renderResult(viewModel, elapsed) {
                    dom.resultNode.textContent = "";
                    var stack = element(dom.document, "div", "result-stack");
                    setResultStatus(
                        viewModel.statusText,
                        viewModel.statusClass,
                        elapsed,
                        dom
                    );
                    viewModel.cards.forEach(function (card) {
                        stack.appendChild(renderResultCard(card, viewModel.data, dom));
                    });
                    dom.resultNode.appendChild(stack);
                }

                function renderTransportError(message) {
                    dom.resultNode.textContent = "";
                    var stack = element(dom.document, "div", "result-stack");
                    setResultStatus("Ошибка запроса", "status-error", undefined, dom);
                    stack.appendChild(errorCard("Не удалось получить результат", message, dom));
                    dom.resultNode.appendChild(stack);
                }

                function renderTechnical(outputs, stale) {
                    var hasOutput = outputs.inspect || outputs.execute;
                    dom.technicalNode.textContent = "";
                    dom.staleBadge.hidden = !stale;
                    if (!hasOutput) {
                        dom.technicalNode.appendChild(element(
                            dom.document,
                            "div",
                            "technical-empty",
                            "Диагностические данные появятся после инспекции или выполнения."
                        ));
                        return;
                    }

                    dom.technicalNode.appendChild(
                        technicalDiagnosticsDetails(outputs, stale, dom)
                    );
                    dom.technicalNode.appendChild(rawResponsesDetails(outputs, dom));
                }

                return {
                    selectOperation: selectOperation,
                    empty: renderEmpty,
                    pending: renderPending,
                    loading: setLoading,
                    result: renderResult,
                    transportError: renderTransportError,
                    technical: renderTechnical
                };
            }

            function technicalDiagnosticsDetails(outputs, stale, dom) {
                var details = dom.document.createElement("details");
                var sections = technicalDiagnosticSections(outputs, stale);
                details.appendChild(detailsHeader(
                    "Диагностика",
                    function () { return technicalDiagnosticLines(sections).join("\n"); },
                    dom
                ));
                sections.forEach(function (section) {
                    var sectionNode = element(
                        dom.document, "section", "diagnostic-section"
                    );
                    sectionNode.appendChild(element(
                        dom.document,
                        "h4",
                        "diagnostic-heading",
                        section.title
                    ));
                    sectionNode.appendChild(diagnosticGrid(section.items, dom));
                    details.appendChild(sectionNode);
                });
                return details;
            }

            function technicalDiagnosticSections(outputs, stale) {
                var inspectData = outputData(outputs.inspect);
                var executeData = outputData(outputs.execute);
                var environment = executeData || inspectData;
                var sections = [];

                if (stale) {
                    sections.push({
                        title: "Состояние",
                        items: [[
                            "Актуальность",
                            "Данные относятся к предыдущей версии XQuery"
                        ]]
                    });
                }
                if (environment) {
                    sections.push({
                        title: "Среда",
                        items: environmentDiagnosticItems(executeData, inspectData)
                    });
                }
                sections.push(operationDiagnosticSection("Инспекция", outputs.inspect, false));
                sections.push(operationDiagnosticSection("Выполнение", outputs.execute, true));
                return sections;
            }

            function environmentDiagnosticItems(preferred, fallback) {
                var fields = [
                    ["Версия контракта", "contractVersion"],
                    ["Версия инспектора", "inspectorVersion"],
                    ["Тип провайдера", "providerType"],
                    ["Сборка провайдера", "providerAssemblyVersion"],
                    ["Тип коллекции", "collectionType"],
                    ["Сборка коллекции", "collectionAssemblyVersion"],
                    ["Внутренняя коллекция", "innerCollectionType"],
                    ["Сборка внутренней коллекции", "innerCollectionAssemblyVersion"],
                    ["Runtime-тип Query", "queryRuntimeType"],
                    ["Сборка Query", "queryAssemblyVersion"],
                    ["Reflection-цепочка", "reflectionPath"],
                    ["Значение QueryType", "queryType"]
                ];
                return fields.map(function (field) {
                    return [
                        field[0],
                        diagnosticValue(preferred, fallback, field[1])
                    ];
                });
            }

            function diagnosticValue(preferred, fallback, name) {
                if (preferred
                    && preferred[name] !== null
                    && preferred[name] !== undefined) {
                    return preferred[name];
                }
                return fallback ? fallback[name] : null;
            }

            function operationDiagnosticSection(title, output, execute) {
                var data = outputData(output);
                var items;
                if (!output) {
                    return { title: title, items: [["Статус", "Не запускалось"]] };
                }
                if (!data) {
                    return {
                        title: title,
                        items: [
                            ["Статус", "Ответ сервера не получен"],
                            ["Ошибка транспорта", output.message]
                        ]
                    };
                }

                items = [
                    ["Статус", data.success
                        ? (execute ? "Выполнено успешно" : "SQL сформирован")
                        : "Ошибка"],
                    ["Этап ошибки", data.failureStage],
                    ["Тип ошибки", data.errorType],
                    ["Ошибка", data.error],
                    ["Ошибка освобождения", data.cleanupError]
                ];
                if (execute) {
                    items = items.concat([
                        ["Выполнение начато", data.executionAttempted],
                        ["Выполнение успешно", data.executionSuccess],
                        ["Прочитано строк", data.rowsRead],
                        ["SQL после выполнения", data.executedSql ? "Получен" : "Не получен"],
                        ["Ошибка получения SQL", data.executedCommandCaptureError]
                    ]);
                } else {
                    items = items.concat([
                        ["SqlOffset", data.sqlOffset],
                        ["Размер страницы", data.pageSize]
                    ]);
                }
                if (data.timingsMs) {
                    items = items.concat([
                        ["Весь вызов", millisecondsText(data.timingsMs.total)],
                        ["Подготовка XQuery", millisecondsText(data.timingsMs.preprocessing)],
                        ["Трансляция", millisecondsText(data.timingsMs.translation)],
                        ["Извлечение команды", millisecondsText(data.timingsMs.extraction)]
                    ]);
                    if (execute) {
                        items.push([
                            "Выполнение",
                            millisecondsText(data.timingsMs.execution)
                        ]);
                    }
                    items.push([
                        "Освобождение коллекции",
                        millisecondsText(data.timingsMs.cleanup)
                    ]);
                }
                return { title: title, items: items };
            }

            function outputData(output) {
                return output && output.type === "result"
                    ? output.viewModel.data
                    : null;
            }

            function diagnosticGrid(items, dom) {
                var grid = element(dom.document, "div", "meta-grid");
                items.forEach(function (item) {
                    var row = element(dom.document, "div", "meta-row");
                    row.appendChild(element(dom.document, "span", "", item[0]));
                    row.appendChild(element(
                        dom.document, "code", "", valueText(item[1])
                    ));
                    grid.appendChild(row);
                });
                return grid;
            }

            function technicalDiagnosticLines(sections) {
                var lines = [];
                sections.forEach(function (section) {
                    lines.push("[" + section.title + "]");
                    section.items.forEach(function (item) {
                        lines.push(item[0] + ": " + valueText(item[1]));
                    });
                    lines.push("");
                });
                return lines;
            }

            function rawResponsesDetails(outputs, dom) {
                var details = dom.document.createElement("details");
                var body = element(dom.document, "div", "json-responses");
                details.appendChild(plainDetailsHeader("Ответы сервера (JSON)", dom));
                appendRawResponse(body, "Инспекция", outputs.inspect, dom);
                appendRawResponse(body, "Выполнение", outputs.execute, dom);
                details.appendChild(body);
                return details;
            }

            function appendRawResponse(parent, title, output, dom) {
                var data = outputData(output);
                if (data) {
                    var json = JSON.stringify(data, null, 2);
                    parent.appendChild(codeCard(
                        "Ответ: " + title,
                        json,
                        json,
                        undefined,
                        dom
                    ));
                } else {
                    parent.appendChild(element(
                        dom.document,
                        "div",
                        "json-response-empty",
                        output
                            ? title + ": исходный ответ не получен. " + output.message
                            : title + ": ещё не запускалось."
                    ));
                }
            }

            function renderResultCard(card, data, dom) {
                if (card.kind === "contract-error") {
                    return errorCard(
                        "Версия JSON-контракта не поддерживается",
                        "Шаблон поддерживает контракт " + config.supportedContractVersion
                            + ", получено: " + valueText(data && data.contractVersion)
                            + ". Ответ доступен ниже без интерпретации.",
                        dom
                    );
                }
                if (card.kind === "legacy-warning") {
                    return element(
                        dom.document,
                        "div",
                        "message",
                        "Ответ DLL не содержит contractVersion. Данные показаны в режиме совместимости; обновите DLL для полной диагностики."
                    );
                }
                if (card.kind === "inspection-sql-warning") {
                    return element(
                        dom.document,
                        "div",
                        "message message-compact",
                        inspectionSqlWarningText(data)
                    );
                }
                if (card.kind === "executed-sql-warning") {
                    return element(
                        dom.document,
                        "div",
                        "message",
                        "SQL ниже повторно прочитан из Query.command после выполнения. "
                            + "Это наблюдаемый снимок UniBridge, а не трассировка на стороне СУБД."
                    );
                }
                if (card.kind === "executed-sql") {
                    return codeCard(
                        "SQL при выполнении",
                        formatSql(data.executedSql || ""),
                        data.executedSql || "",
                        "primary-sql",
                        dom
                    );
                }
                if (card.kind === "executed-parameters") {
                    return parametersCard(data.executedParameters || [], dom);
                }
                if (card.kind === "sql") {
                    return codeCard(
                        "Предварительный SQL",
                        formatSql(data.sql || ""),
                        data.sql || "",
                        "primary-sql",
                        dom
                    );
                }
                if (card.kind === "parameters") {
                    return parametersCard(data.parameters || [], dom);
                }
                if (card.kind === "effective-xquery") {
                    var xquery = effectiveXQuery(data);
                    return collapsibleCodeCard(
                        "Эффективный XQuery",
                        xquery,
                        xquery,
                        card.expanded,
                        "effective-xquery",
                        dom
                    );
                }
                if (card.kind === "count-sql") {
                    return collapsibleCodeCard(
                        "Count SQL",
                        formatSql(data.countSql),
                        data.countSql,
                        card.expanded,
                        undefined,
                        dom
                    );
                }
                if (card.kind === "execution-count-sql") {
                    return collapsibleCodeCard(
                        "Count SQL · отдельно не выполнялся",
                        formatSql(data.countSql),
                        data.countSql,
                        card.expanded,
                        undefined,
                        dom
                    );
                }
                if (card.kind === "error") {
                    return errorCard(data.errorType, data.error, dom);
                }
                if (card.kind === "cleanup-error") {
                    return errorCard("Ошибка освобождения коллекции", data.cleanupError, dom);
                }
                if (card.kind === "executed-command-capture-error") {
                    return errorCard(
                        "Не удалось получить SQL после выполнения",
                        data.executedCommandCaptureError,
                        dom
                    );
                }
                return errorCard(
                    "Неизвестный блок результата",
                    card.kind || "Не указан тип блока.",
                    dom
                );
            }

            function setResultStatus(text, className, elapsed, dom) {
                dom.resultStatusNode.textContent = "";
                dom.resultStatusNode.appendChild(element(
                    dom.document, "div", "status " + className, text
                ));
                if (typeof elapsed === "number") {
                    dom.resultStatusNode.appendChild(element(
                        dom.document,
                        "div",
                        "duration",
                        Math.round(elapsed) + " ms · браузер"
                    ));
                }
            }

            function codeCard(title, displayValue, copyValue, extraClass, dom) {
                var card = element(
                    dom.document,
                    "section",
                    "code-card" + (extraClass ? " " + extraClass : "")
                );
                var header = element(dom.document, "div", "card-header");
                header.appendChild(element(dom.document, "div", "card-title", title));
                header.appendChild(copyButton(
                    "Копировать", function () { return copyValue; }, dom
                ));
                card.appendChild(header);
                card.appendChild(element(
                    dom.document, "pre", "code-output", displayValue || "—"
                ));
                return card;
            }

            function collapsibleCodeCard(
                title, displayValue, copyValue, expanded, extraClass, dom
            ) {
                var card = element(
                    dom.document,
                    "details",
                    "code-card" + (extraClass ? " " + extraClass : "")
                );
                card.open = expanded === true;
                card.appendChild(detailsHeader(
                    title, function () { return copyValue; }, dom
                ));
                card.appendChild(element(
                    dom.document, "pre", "code-output", displayValue || "—"
                ));
                return card;
            }

            function detailsHeader(title, getText, dom) {
                var header = element(dom.document, "summary", "details-header");
                var button = copyButton("Копировать", getText, dom);
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                });
                header.appendChild(element(dom.document, "span", "card-title", title));
                header.appendChild(button);
                return header;
            }

            function plainDetailsHeader(title, dom) {
                var header = element(dom.document, "summary", "details-header");
                header.appendChild(element(dom.document, "span", "card-title", title));
                return header;
            }

            function parametersCard(parameters, dom) {
                var card = element(dom.document, "section", "data-card");
                var header = element(dom.document, "div", "card-header");
                header.appendChild(element(
                    dom.document, "div", "card-title", "Параметры · " + parameters.length
                ));
                header.appendChild(copyButton(
                    "Копировать таблицу",
                    function () { return parametersTsv(parameters); },
                    dom
                ));
                card.appendChild(header);

                if (!parameters.length) {
                    card.appendChild(element(
                        dom.document, "div", "empty-table", "Параметры отсутствуют."
                    ));
                    return card;
                }

                var table = element(dom.document, "table", "parameters");
                var thead = dom.document.createElement("thead");
                var headRow = dom.document.createElement("tr");
                ["Имя", "Тип", "Значение"].forEach(function (label) {
                    headRow.appendChild(element(dom.document, "th", "", label));
                });
                thead.appendChild(headRow);
                table.appendChild(thead);

                var tbody = dom.document.createElement("tbody");
                parameters.forEach(function (parameter) {
                    var row = dom.document.createElement("tr");
                    var nameCell = dom.document.createElement("td");
                    nameCell.appendChild(element(
                        dom.document, "code", "", valueText(parameter.name)
                    ));
                    row.appendChild(nameCell);
                    row.appendChild(element(
                        dom.document, "td", "", valueText(parameter.type)
                    ));
                    row.appendChild(element(
                        dom.document, "td", "", valueText(parameter.value)
                    ));
                    tbody.appendChild(row);
                });
                table.appendChild(tbody);
                card.appendChild(table);
                return card;
            }

            function parametersTsv(parameters) {
                var rows = [["Имя", "Тип", "Значение"]];
                parameters.forEach(function (parameter) {
                    rows.push([
                        parameter ? parameter.name : null,
                        parameter ? parameter.type : null,
                        parameter ? parameter.value : null
                    ]);
                });
                return rows.map(function (row) {
                    return row.map(tsvCell).join("\t");
                }).join("\n");
            }

            function tsvCell(value) {
                var text;
                if (value === null || value === undefined) {
                    text = "";
                } else if (typeof value === "object") {
                    text = JSON.stringify(value);
                } else {
                    text = String(value);
                }
                return text
                    .replace(/\\/g, "\\\\")
                    .replace(/\t/g, "\\t")
                    .replace(/\r\n|\r|\n/g, "\\n");
            }

            function copyButton(label, getText, dom) {
                var button = element(dom.document, "button", "button copy-button", label);
                button.type = "button";
                button.copyLabel = label;
                button.copyTitle = button.title;
                button.addEventListener("click", function () {
                    copyText(getText(), button);
                });
                return button;
            }

            function errorCard(type, message, dom) {
                var box = element(dom.document, "section", "error-box");
                box.appendChild(element(
                    dom.document, "div", "error-type", type || "Error"
                ));
                box.appendChild(element(
                    dom.document,
                    "pre",
                    "error-text",
                    message || "Неизвестная ошибка."
                ));
                return box;
            }

            function inspectionSqlWarningText(data) {
                var pageSize = typeof data.pageSize === "number" && data.pageSize > 0
                    ? data.pageSize
                    : 400;
                var text = "Предварительный SQL — запрос ещё не выполнялся.";
                if (data.sqlOffset === true) {
                    text += " UniBridge может добавить сортировку и пагинацию"
                        + " (страница " + pageSize + " записей).";
                }
                return text + " Наблюдаемую команду смотрите во вкладке «Выполнение».";
            }

            function millisecondsText(value) {
                if (typeof value !== "number" || !isFinite(value)) {
                    return "—";
                }
                return value.toFixed(3) + " ms";
            }

            function valueText(value) {
                if (value === null || value === undefined) {
                    return "—";
                }
                if (typeof value === "object") {
                    return JSON.stringify(value);
                }
                return String(value);
            }

            // DOM helper and copying
            function element(ownerDocument, tag, className, text) {
                var node = ownerDocument.createElement(tag);
                if (className) {
                    node.className = className;
                }
                if (text !== undefined) {
                    node.textContent = text;
                }
                return node;
            }

            function copyText(text, button) {
                var attempt = (button.copyAttempt || 0) + 1;
                var result;
                button.copyAttempt = attempt;

                if (navigator.clipboard && window.isSecureContext) {
                    try {
                        result = Promise.resolve(navigator.clipboard.writeText(text)).then(
                            function () { return { success: true }; },
                            function () { return fallbackCopy(text); }
                        );
                    } catch (error) {
                        result = Promise.resolve(fallbackCopy(text));
                    }
                } else {
                    result = Promise.resolve(fallbackCopy(text));
                }

                return result.then(function (copyResult) {
                    showCopyFeedback(button, attempt, copyResult);
                    return copyResult.success;
                });
            }

            function fallbackCopy(text) {
                var helper;
                try {
                    helper = document.createElement("textarea");
                    helper.value = text;
                    helper.style.position = "fixed";
                    helper.style.opacity = "0";
                    document.body.appendChild(helper);
                    helper.select();
                    if (document.execCommand("copy") === true) {
                        return { success: true };
                    }
                    return {
                        success: false,
                        reason: "Браузер не подтвердил копирование."
                    };
                } catch (error) {
                    return {
                        success: false,
                        reason: "Браузер заблокировал копирование."
                    };
                } finally {
                    if (helper && helper.parentNode) {
                        helper.parentNode.removeChild(helper);
                    }
                }
            }

            function showCopyFeedback(button, attempt, result) {
                if (button.copyAttempt !== attempt) {
                    return;
                }

                if (result.success) {
                    button.textContent = "Скопировано";
                    button.title = button.copyTitle;
                } else {
                    button.textContent = "Не скопировано";
                    button.title = result.reason;
                }

                window.setTimeout(function () {
                    if (button.copyAttempt === attempt) {
                        button.textContent = button.copyLabel;
                    }
                }, 1200);
            }

            function formatXQuery(source) {
                return breakBeforeKeywords(source, [
                    "order by", "group by", "for", "let", "where", "return"
                ]);
            }

            function formatSql(source) {
                return breakBeforeKeywords(source, [
                    "left outer join", "right outer join", "full outer join",
                    "inner join", "left join", "right join", "full join", "cross join",
                    "order by", "group by", "union all", "select", "from", "where",
                    "having", "join", "union", "and", "or"
                ]);
            }

            function breakBeforeKeywords(source, keywords) {
                var result = "";
                var lower = source.toLowerCase();
                var quote = "";
                var bracket = false;
                var lineComment = false;
                var sqlBlockComment = false;
                var xqueryCommentDepth = 0;
                var index = 0;

                while (index < source.length) {
                    var current = source.charAt(index);
                    var next = source.charAt(index + 1);

                    if (lineComment) {
                        result += current;
                        if (current === "\n") {
                            lineComment = false;
                        }
                        index += 1;
                        continue;
                    }

                    if (sqlBlockComment) {
                        result += current;
                        if (current === "*" && next === "/") {
                            result += next;
                            sqlBlockComment = false;
                            index += 2;
                        } else {
                            index += 1;
                        }
                        continue;
                    }

                    if (xqueryCommentDepth > 0) {
                        result += current;
                        if (current === "(" && next === ":") {
                            result += next;
                            xqueryCommentDepth += 1;
                            index += 2;
                        } else if (current === ":" && next === ")") {
                            result += next;
                            xqueryCommentDepth -= 1;
                            index += 2;
                        } else {
                            index += 1;
                        }
                        continue;
                    }

                    if (quote) {
                        result += current;
                        if (current === quote) {
                            if (next === quote) {
                                result += next;
                                index += 2;
                                continue;
                            }
                            quote = "";
                        }
                        index += 1;
                        continue;
                    }

                    if (bracket) {
                        result += current;
                        if (current === "]") {
                            bracket = false;
                        }
                        index += 1;
                        continue;
                    }

                    if (current === "'" || current === "\"") {
                        quote = current;
                        result += current;
                        index += 1;
                        continue;
                    }
                    if (current === "[") {
                        bracket = true;
                        result += current;
                        index += 1;
                        continue;
                    }
                    if (current === "-" && next === "-") {
                        lineComment = true;
                        result += current + next;
                        index += 2;
                        continue;
                    }
                    if (current === "/" && next === "*") {
                        sqlBlockComment = true;
                        result += current + next;
                        index += 2;
                        continue;
                    }
                    if (current === "(" && next === ":") {
                        xqueryCommentDepth = 1;
                        result += current + next;
                        index += 2;
                        continue;
                    }

                    var matched = "";
                    var keywordIndex;
                    for (keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
                        var keyword = keywords[keywordIndex];
                        var before = index > 0 ? lower.charAt(index - 1) : "";
                        var after = lower.charAt(index + keyword.length);
                        if (lower.slice(index, index + keyword.length) === keyword
                            && !isWordCharacter(before)
                            && !isWordCharacter(after)) {
                            matched = source.slice(index, index + keyword.length);
                            break;
                        }
                    }

                    if (matched) {
                        result = result.replace(/[ \t]+$/g, "");
                        if (result && result.charAt(result.length - 1) !== "\n") {
                            result += "\n";
                        }
                        result += matched;
                        index += matched.length;
                    } else {
                        result += current;
                        index += 1;
                    }
                }

                return result;
            }

            function isWordCharacter(value) {
                return value !== "" && /[A-Za-z0-9_$:\/.\-]/.test(value);
            }
        }());
