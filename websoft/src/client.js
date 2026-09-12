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
                var state = { status: "idle" };
                var transport = createTransport(fetchImplementation, config.inspectEndpoint);
                var render = createRenderer(dom);

                function inspect() {
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
                        render.transportError(validationMessage);
                        dom.editor.focus();
                        return Promise.resolve();
                    }

                    state.status = "loading";
                    render.loading(true);
                    startedAt = now();

                    return transport.inspect(xquery).then(function (data) {
                        var viewModel = resultViewModel(data);
                        state.status = viewModel.state;
                        render.result(viewModel, now() - startedAt);
                    }, function (error) {
                        state.status = "error";
                        render.transportError(
                            error && error.message ? error.message : String(error)
                        );
                    }).then(function () {
                        render.loading(false);
                    }, function (error) {
                        state.status = "error";
                        render.loading(false);
                        render.transportError(
                            error && error.message ? error.message : String(error)
                        );
                    });
                }

                bindEditor(dom, inspect);
                dom.editor.value = config.sample;
                updateLineNumbers(dom);

                return { inspect: inspect, state: state };
            }

            function getDom(root) {
                return {
                    document: root.ownerDocument,
                    editor: root.querySelector("#xqi-editor"),
                    lineNumbers: root.querySelector("#xqi-line-numbers"),
                    inspectButton: root.querySelector("#xqi-inspect-button"),
                    inspectButtonLabel: root.querySelector("#xqi-inspect-button-label"),
                    resultNode: root.querySelector("#xqi-result"),
                    resultStatusNode: root.querySelector("#xqi-result-status"),
                    formatButton: root.querySelector("#xqi-format-button"),
                    sampleButton: root.querySelector("#xqi-sample-button"),
                    clearButton: root.querySelector("#xqi-clear-button")
                };
            }

            // Request state and editor
            function bindEditor(dom, inspect) {
                dom.editor.addEventListener("input", function () {
                    updateLineNumbers(dom);
                });
                dom.editor.addEventListener("scroll", function () {
                    dom.lineNumbers.scrollTop = dom.editor.scrollTop;
                });
                dom.editor.addEventListener("keydown", function (event) {
                    handleEditorKeydown(event, dom, inspect);
                });
                dom.inspectButton.addEventListener("click", inspect);
                dom.formatButton.addEventListener("click", function () {
                    dom.editor.value = formatXQuery(dom.editor.value);
                    updateLineNumbers(dom);
                    dom.editor.focus();
                });
                dom.sampleButton.addEventListener("click", function () {
                    dom.editor.value = config.sample;
                    updateLineNumbers(dom);
                    dom.editor.focus();
                });
                dom.clearButton.addEventListener("click", function () {
                    dom.editor.value = "";
                    updateLineNumbers(dom);
                    dom.editor.focus();
                });
            }

            function handleEditorKeydown(event, dom, inspect) {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    inspect();
                    return;
                }

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
                    return "Введите XQuery для инспекции.";
                }
                if (xQueryCharacterCount(xquery) > config.maxXQueryLength) {
                    return "XQuery превышает ограничение "
                        + config.maxXQueryLength + " символов.";
                }
                return "";
            }

            // Transport
            function createTransport(fetchImplementation, endpoint) {
                function inspect(xquery) {
                    return fetchImplementation(endpoint, {
                        method: "POST",
                        credentials: "same-origin",
                        headers: {
                            "Accept": "application/json",
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest"
                        },
                        body: "action=inspect&xquery=" + encodeURIComponent(xquery)
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

                return { inspect: inspect };
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

                return {
                    state: data.success ? "result" : "error",
                    statusText: data.success ? "SQL сформирован" : "Ошибка инспекции",
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
                    return [
                        { kind: "contract-error" },
                        { kind: "raw", expanded: false }
                    ];
                }
                if (contractState === "legacy") {
                    cards.push({ kind: "legacy-warning" });
                }
                if (data.success) {
                    cards.push({ kind: "sql" });
                    cards.push({ kind: "parameters" });
                    cards.push({ kind: "effective-xquery", expanded: true });
                    if (data.countSql) {
                        cards.push({ kind: "count-sql", expanded: false });
                    }
                } else {
                    cards.push({ kind: "error" });
                }
                if (data.cleanupError) {
                    cards.push({ kind: "cleanup-error" });
                }
                cards.push({ kind: "diagnostics", expanded: false });
                cards.push({ kind: "raw", expanded: false });
                return cards;
            }

            // Result rendering
            function createRenderer(dom) {
                function setLoading(loading) {
                    var oldSpinner = dom.inspectButton.querySelector(".spinner");
                    dom.inspectButton.disabled = loading;
                    dom.inspectButtonLabel.textContent = loading
                        ? "Инспекция…" : "Инспектировать";

                    if (loading && !oldSpinner) {
                        var spinner = element(dom.document, "span", "spinner");
                        spinner.setAttribute("aria-hidden", "true");
                        dom.inspectButton.insertBefore(spinner, dom.inspectButtonLabel);
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

                return {
                    loading: setLoading,
                    result: renderResult,
                    transportError: renderTransportError
                };
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
                if (card.kind === "sql") {
                    return codeCard(
                        "SQL", formatSql(data.sql || ""), data.sql || "", "primary-sql", dom
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
                if (card.kind === "error") {
                    return errorCard(data.errorType, data.error, dom);
                }
                if (card.kind === "cleanup-error") {
                    return errorCard("Ошибка освобождения коллекции", data.cleanupError, dom);
                }
                if (card.kind === "diagnostics") {
                    return diagnosticsDetails(data, dom);
                }
                return rawDetails(data, dom);
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

            function diagnosticsDetails(data, dom) {
                var details = dom.document.createElement("details");
                var grid = element(dom.document, "div", "meta-grid");
                var items = diagnosticItems(data);

                details.appendChild(detailsHeader(
                    "Диагностика инспектора",
                    function () { return diagnosticLines(data).join("\n"); },
                    dom
                ));
                items.forEach(function (item) {
                    var row = element(dom.document, "div", "meta-row");
                    row.appendChild(element(dom.document, "span", "", item[0]));
                    row.appendChild(element(
                        dom.document, "code", "", valueText(item[1])
                    ));
                    grid.appendChild(row);
                });
                details.appendChild(grid);

                return details;
            }

            function diagnosticItems(data) {
                var items = [
                    ["Версия контракта", data.contractVersion],
                    ["Версия инспектора", data.inspectorVersion],
                    ["Этап ошибки", data.failureStage],
                    ["Reflection-цепочка", data.reflectionPath],
                    ["Тип провайдера", data.providerType],
                    ["Сборка провайдера", data.providerAssemblyVersion],
                    ["Тип коллекции", data.collectionType],
                    ["Сборка коллекции", data.collectionAssemblyVersion],
                    ["Внутренняя коллекция", data.innerCollectionType],
                    ["Сборка внутренней коллекции", data.innerCollectionAssemblyVersion],
                    ["Runtime-тип Query", data.queryRuntimeType],
                    ["Сборка Query", data.queryAssemblyVersion],
                    ["Значение QueryType", data.queryType]
                ];

                if (data.timingsMs) {
                    items = items.concat([
                        ["Весь вызов", millisecondsText(data.timingsMs.total)],
                        ["Подготовка XQuery", millisecondsText(data.timingsMs.preprocessing)],
                        ["Трансляция", millisecondsText(data.timingsMs.translation)],
                        ["Извлечение команды", millisecondsText(data.timingsMs.extraction)],
                        ["Освобождение коллекции", millisecondsText(data.timingsMs.cleanup)]
                    ]);
                }
                return items;
            }

            function diagnosticLines(data) {
                return diagnosticItems(data).map(function (item) {
                    return item[0] + ": " + valueText(item[1]);
                });
            }

            function millisecondsText(value) {
                if (typeof value !== "number" || !isFinite(value)) {
                    return "—";
                }
                return value.toFixed(3) + " ms";
            }

            function rawDetails(data, dom) {
                var json = JSON.stringify(data, null, 2);
                return collapsibleCodeCard(
                    "Исходный JSON", json, json, false, undefined, dom
                );
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
                return breakBeforeKeywords(source, ["order by", "for", "let", "where", "return"]);
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
