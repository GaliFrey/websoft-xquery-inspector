function RunXQueryInspectorCompatibilityAgent()
{
    var logName = "xquery_inspector_compatibility";
    var supportedContractVersion = 1;
    var expectedInspectorVersion = "1.4.2";
    var knownReflectionPaths = ["collection.dc.Query.command"];
    var maxXQueryLength = 200000;
    var scenarios = [
    {
        "id": "basic-parameter",
        "kind": "basic",
        "expectedFailureStage": null,
        "expectedParameterValue": "6148914691236517121",
        "provider": null,
        "xquery": "for $elem in collaborators\nwhere $elem/id = 6148914691236517121\nreturn $elem/Fields('id', 'fullname')",
        "generated": null
    },
    {
        "id": "basic-execution",
        "kind": "execution",
        "expectedFailureStage": null,
        "expectedParameterValue": "6148914691236517121",
        "provider": null,
        "xquery": "for $elem in collaborators\nwhere $elem/id = 6148914691236517121\nreturn $elem/Fields('id', 'fullname')",
        "generated": null
    },
    {
        "id": "hierarchy-child",
        "kind": "hierarchy",
        "expectedFailureStage": null,
        "expectedParameterValue": null,
        "provider": null,
        "xquery": "for $elem in subdivisions\nwhere IsHierChild($elem/id, 6327975429225669221)\norder by $elem/Hier()\nreturn $elem/Fields('id', 'name')",
        "generated": null
    },
    {
        "id": "hierarchy-self",
        "kind": "hierarchy",
        "expectedFailureStage": null,
        "expectedParameterValue": null,
        "provider": null,
        "xquery": "for $elem in subdivisions\nwhere IsHierChildOrSelf($elem/id, 6327975429225669221)\norder by $elem/Hier()\nreturn $elem/Fields('id', 'name')",
        "generated": null
    },
    {
        "id": "invalid-query",
        "kind": "invalid",
        "expectedFailureStage": "preprocess-xquery",
        "expectedParameterValue": null,
        "provider": null,
        "xquery": "for $elem in subdivisions\nwhere IsHierChild($elem/id, 1 return $elem",
        "generated": null
    },
    {
        "id": "invalid-provider-query",
        "kind": "invalid",
        "expectedFailureStage": "invoke-xquery",
        "expectedParameterValue": null,
        "provider": null,
        "xquery": "for $elem in collaborators\nwhere $elem/fullname = 'unfinished\nreturn $elem/id",
        "generated": null
    },
    {
        "id": "max-length-xquery",
        "kind": "boundary",
        "expectedFailureStage": null,
        "expectedParameterValue": null,
        "provider": null,
        "xquery": null,
        "generated": "max-xquery"
    },
    {
        "id": "oversized-xquery",
        "kind": "oversized",
        "expectedFailureStage": null,
        "expectedParameterValue": null,
        "provider": null,
        "xquery": null,
        "generated": "max-xquery-plus-one"
    }
];
    var passed = 0;
    var failed = 0;
    var skipped = 0;
    var loggingEnabled = false;

    function executeAgent()
    {
        try
        {
            EnableLog(logName, true);
            loggingEnabled = true;
            writeLog(
                "RUN",
                "START|agentContract=2|inspector=" + expectedInspectorVersion
                    + "|scenarios=" + ArrayCount(scenarios)
            );

            var assembly = tools.dotnet_host.Object.GetAssembly(
                "XQueryInspector.dll"
            );
            var inspector = assembly.CreateClassObject(
                "XQueryInspector.Inspector"
            );
            var provider = tools.spxml_unibridge.Object.provider;
            var providerType = inspector.Describe(provider);
            var context = {
                providerKind: detectProviderKind(providerType),
                providerType: providerType
            };

            writeLog(
                "ENV",
                "provider=" + context.providerKind
                    + "|providerType=" + safeField(providerType)
            );

            var index;
            for (index = 0; index < ArrayCount(scenarios); index++)
            {
                runScenario(inspector, provider, scenarios[index], context);
            }
        }
        catch (fatalError)
        {
            failed++;
            writeLog("FATAL", "error=" + errorText(fatalError));
        }
        finally
        {
            if (loggingEnabled)
            {
                writeLog(
                    "SUMMARY",
                    "passed=" + passed + "|failed=" + failed + "|skipped=" + skipped
                );
                writeLog("RUN", "END");
                EnableLog(logName, false);
            }
        }
    }

    function runScenario(inspector, provider, scenario, context)
    {
        if (IsEmptyValue(scenario.provider) == false)
        {
            if (scenario.provider != context.providerKind)
            {
                var skipReason = "provider-mismatch";
                if (context.providerKind == "unknown")
                {
                    skipReason = "provider-undetected";
                }
                skipped++;
                writeLog(
                    "SKIP",
                    "scenario=" + safeField(scenario.id)
                        + "|reason=" + skipReason
                );
                return;
            }
        }

        try
        {
            writeLog("BEGIN", "scenario=" + safeField(scenario.id));
            var xquery = scenario.xquery;
            if (scenario.generated == "max-xquery-plus-one")
            {
                xquery = repeatText("x", maxXQueryLength + 1);
            }
            else if (scenario.generated == "max-xquery")
            {
                var prefix = "for $elem in collaborators return $elem/id";
                xquery = prefix + repeatText(
                    " ",
                    maxXQueryLength - StrCharCount(prefix)
                );
            }

            var resultText;
            if (scenario.kind == "execution")
            {
                resultText = inspector.Execute(provider, xquery);
            }
            else
            {
                resultText = inspector.Inspect(provider, xquery);
            }
            var result = ParseJson(resultText);
            var errors = validateResult(scenario, result, context);
            if (scenario.kind == "basic")
            {
                if (context.providerKind != "unknown")
                {
                    writeLog("ENV", "providerDetected=" + context.providerKind);
                }
            }

            if (ArrayCount(errors) == 0)
            {
                passed++;
                writeLog(
                    "PASS",
                    "scenario=" + safeField(scenario.id) + resultDetails(result)
                );
            }
            else
            {
                failed++;
                writeLog(
                    "FAIL",
                        "scenario=" + safeField(scenario.id)
                        + "|checks=" + safeField(joinValues(errors, ","))
                        + resultDetails(result)
                );
            }
        }
        catch (scenarioError)
        {
            failed++;
            writeLog(
                "FAIL",
                "scenario=" + safeField(scenario.id)
                    + "|checks=agent-exception"
                    + "|error=" + errorText(scenarioError)
            );
        }
    }

    function validateResult(scenario, result, context)
    {
        var errors = [];
        if (isMissing(result))
        {
            errors.push("empty-result");
            return errors;
        }

        if (result.contractVersion != supportedContractVersion)
        {
            errors.push("contract-version");
        }
        if (hasText(result.inspectorVersion) == false)
        {
            errors.push("inspector-version");
        }
        else if (
            StrBegins(
                "" + result.inspectorVersion,
                expectedInspectorVersion,
                false
            ) == false
        )
        {
            errors.push("inspector-version");
        }
        if (scenario.kind == "execution")
        {
            if (result.operation != "execute")
            {
                errors.push("operation");
            }
        }
        else if (result.operation != "inspect")
        {
            errors.push("operation");
        }
        if (hasText(result.cleanupError))
        {
            errors.push("cleanup-error");
        }
        if (isMissing(result.timingsMs))
        {
            errors.push("total-timing");
        }
        else if (isMissing(result.timingsMs.total))
        {
            errors.push("total-timing");
        }

        if (scenario.kind == "basic")
        {
            validateBasic(scenario, result, context, errors);
        }
        else if (scenario.kind == "hierarchy")
        {
            validateHierarchy(result, errors);
        }
        else if (scenario.kind == "execution")
        {
            validateExecution(scenario, result, context, errors);
        }
        else if (scenario.kind == "invalid")
        {
            if (result.success != false)
            {
                errors.push("invalid-query-succeeded");
            }
            if (hasText(result.failureStage) == false)
            {
                errors.push("invalid-query-diagnostics");
            }
            else if (hasText(result.errorType) == false)
            {
                errors.push("invalid-query-diagnostics");
            }
            if (IsEmptyValue(scenario.expectedFailureStage) == false)
            {
                if (result.failureStage != scenario.expectedFailureStage)
                {
                    errors.push("invalid-query-stage");
                }
            }
        }
        else if (scenario.kind == "oversized")
        {
            if (result.success != false)
            {
                errors.push("xquery-limit");
            }
            else if (result.failureStage != "validate-input")
            {
                errors.push("xquery-limit");
            }
        }
        else if (scenario.kind == "boundary")
        {
            if (result.success != true)
            {
                errors.push("xquery-boundary");
            }
            else if (hasText(result.sql) == false)
            {
                errors.push("xquery-boundary");
            }
            else if (hasSuccessfulTimings(result) == false)
            {
                errors.push("xquery-boundary");
            }
        }
        else
        {
            errors.push("unknown-scenario-kind");
        }

        return errors;
    }

    function validateExecution(scenario, result, context, errors)
    {
        if (result.success != true)
        {
            errors.push("execution-failed");
            return;
        }
        if (result.executionAttempted != true)
        {
            errors.push("execution-not-attempted");
        }
        if (result.executionSuccess != true)
        {
            errors.push("execution-status");
        }
        if (isMissing(result.rowsRead))
        {
            errors.push("execution-row-count");
        }
        else if (result.rowsRead < 0)
        {
            errors.push("execution-row-count");
        }
        if (hasText(result.executedSql) == false)
        {
            errors.push("empty-executed-sql");
        }
        if (hasText(result.countSql) == false)
        {
            errors.push("empty-count-sql");
        }
        if (hasText(result.executedCommandCaptureError))
        {
            errors.push("executed-command-capture");
        }
        if (knownReflectionPath(result.reflectionPath) == false)
        {
            errors.push("reflection-path");
        }
        if (hasRuntimeMetadata(result) == false)
        {
            errors.push("runtime-metadata");
        }
        if (hasSuccessfulTimings(result) == false)
        {
            errors.push("successful-timings");
        }
        else if (isMissing(result.timingsMs.execution))
        {
            errors.push("execution-timing");
        }

        validateParameterList(
            scenario,
            result.parameters,
            context,
            errors,
            ""
        );
        validateParameterList(
            scenario,
            result.executedParameters,
            context,
            errors,
            "executed-"
        );
    }

    function validateBasic(scenario, result, context, errors)
    {
        if (result.success != true)
        {
            errors.push("inspection-failed");
            return;
        }
        if (hasText(result.sql) == false)
        {
            errors.push("empty-sql");
        }
        if (hasText(result.countSql) == false)
        {
            errors.push("empty-count-sql");
        }
        if (knownReflectionPath(result.reflectionPath) == false)
        {
            errors.push("reflection-path");
        }
        if (hasRuntimeMetadata(result) == false)
        {
            errors.push("runtime-metadata");
        }
        if (result.reflectionPath == "collection.dc.Query.command")
        {
            if (hasText(result.innerCollectionAssemblyVersion) == false)
            {
                errors.push("inner-collection-version");
            }
        }
        if (hasSuccessfulTimings(result) == false)
        {
            errors.push("successful-timings");
        }
        validateParameterList(
            scenario,
            result.parameters,
            context,
            errors,
            ""
        );
    }

    function validateParameterList(scenario, parameters, context, errors, prefix)
    {
        if (isMissing(parameters))
        {
            errors.push(prefix + "parameters");
            return;
        }
        if (ArrayCount(parameters) == 0)
        {
            errors.push(prefix + "parameters");
            return;
        }

        var parameter = parameters[0];
        if (hasText(parameter.name) == false)
        {
            errors.push(prefix + "parameter-metadata");
        }
        else if (hasText(parameter.type) == false)
        {
            errors.push(prefix + "parameter-metadata");
        }
        if (parameter.type == "BigInt")
        {
            context.providerKind = "mssql";
        }
        else if (parameter.type == "bigint")
        {
            context.providerKind = "postgresql";
        }
        else
        {
            errors.push(prefix + "provider-kind");
        }

        if (IsEmptyValue(scenario.expectedParameterValue) == false)
        {
            if (("" + parameter.value) != scenario.expectedParameterValue)
            {
                errors.push(prefix + "parameter-value");
            }
        }
    }

    function validateHierarchy(result, errors)
    {
        if (result.success != true)
        {
            errors.push("inspection-failed");
            return;
        }
        if (hasText(result.sql) == false)
        {
            errors.push("empty-sql");
        }
        if (hasText(result.effectiveXQuery) == false)
        {
            errors.push("effective-xquery");
            return;
        }
        if (StrContains(result.effectiveXQuery, "IsHierChild", false))
        {
            errors.push("hierarchy-condition-remained");
        }
        if (StrContains(result.effectiveXQuery, "/Hier(", false) == false)
        {
            errors.push("hierarchy-argument-missing");
        }
    }

    function resultDetails(result)
    {
        if (isMissing(result))
        {
            return "";
        }

        var details = "";
        if (hasText(result.inspectorVersion))
        {
            details += "|inspector=" + safeField(result.inspectorVersion);
        }
        if (hasText(result.operation))
        {
            details += "|operation=" + safeField(result.operation);
        }
        if (hasText(result.reflectionPath))
        {
            details += "|reflection=" + safeField(result.reflectionPath);
        }
        if (hasText(result.providerAssemblyVersion))
        {
            details += "|providerAssembly="
                + safeField(result.providerAssemblyVersion);
        }
        if (hasText(result.collectionAssemblyVersion))
        {
            details += "|collectionAssembly="
                + safeField(result.collectionAssemblyVersion);
        }
        if (hasText(result.queryAssemblyVersion))
        {
            details += "|queryAssembly="
                + safeField(result.queryAssemblyVersion);
        }
        if (hasText(result.failureStage))
        {
            details += "|stage=" + safeField(result.failureStage);
        }
        if (isMissing(result.parameters) == false)
        {
            details += "|parameters=" + ArrayCount(result.parameters);
            var parameterTypes = [];
            var parameterIndex;
            for (
                parameterIndex = 0;
                parameterIndex < ArrayCount(result.parameters);
                parameterIndex++
            )
            {
                parameterTypes.push(safeField(result.parameters[parameterIndex].type));
            }
            details += "|parameterTypes=" + joinValues(parameterTypes, ",");
        }
        if (hasText(result.sql))
        {
            details += "|sqlLength=" + StrCharCount(result.sql);
        }
        if (hasText(result.executedSql))
        {
            details += "|executedSqlLength=" + StrCharCount(result.executedSql);
        }
        if (isMissing(result.executedParameters) == false)
        {
            details += "|executedParameters=" + ArrayCount(result.executedParameters);
            var executedParameterTypes = [];
            var executedParameterIndex;
            for (
                executedParameterIndex = 0;
                executedParameterIndex < ArrayCount(result.executedParameters);
                executedParameterIndex++
            )
            {
                executedParameterTypes.push(
                    safeField(result.executedParameters[executedParameterIndex].type)
                );
            }
            details += "|executedParameterTypes="
                + joinValues(executedParameterTypes, ",");
        }
        if (isMissing(result.executionAttempted) == false)
        {
            details += "|executionAttempted=" + safeField(result.executionAttempted);
        }
        if (isMissing(result.executionSuccess) == false)
        {
            details += "|executionSuccess=" + safeField(result.executionSuccess);
        }
        if (isMissing(result.rowsRead) == false)
        {
            details += "|rowsRead=" + safeField(result.rowsRead);
        }
        if (isMissing(result.timingsMs) == false)
        {
            if (isMissing(result.timingsMs.total) == false)
            {
                details += "|totalMs=" + safeField(result.timingsMs.total);
            }
        }
        return details;
    }

    function knownReflectionPath(value)
    {
        var index;
        for (index = 0; index < ArrayCount(knownReflectionPaths); index++)
        {
            if (knownReflectionPaths[index] == value)
            {
                return true;
            }
        }
        return false;
    }

    function detectProviderKind(providerType)
    {
        var value = "";
        if (IsEmptyValue(providerType) == false)
        {
            value = StrLowerCase("" + providerType);
        }
        if (StrContains(value, "postgres", false))
        {
            return "postgresql";
        }
        if (StrContains(value, "npgsql", false))
        {
            return "postgresql";
        }
        if (StrContains(value, "mssql", false))
        {
            return "mssql";
        }
        if (StrContains(value, "sqlserver", false))
        {
            return "mssql";
        }
        if (StrContains(value, "sqlclient", false))
        {
            return "mssql";
        }
        return "unknown";
    }

    function repeatText(value, count)
    {
        var result = "";
        var block = "";
        var index;
        for (index = 0; index < 1000; index++)
        {
            block += value;
        }
        var blockCharacterCount = StrCharCount(block);
        for (index = 0; index + blockCharacterCount <= count; index += blockCharacterCount)
        {
            result += block;
        }
        for (; index < count; index++)
        {
            result += value;
        }
        return result;
    }

    function hasText(value)
    {
        return IsEmptyValue(value) == false;
    }

    function errorText(error)
    {
        if (isMissing(error))
        {
            return "Error";
        }
        return safeField("" + error);
    }

    function safeField(value)
    {
        var text = "";
        if (IsEmptyValue(value) == false)
        {
            text = "" + value;
        }
        text = StrReplace(text, "\r", " ");
        text = StrReplace(text, "\n", " ");
        text = StrReplace(text, "|", "/");
        if (StrCharCount(text) > 300)
        {
            return StrLeftCharRange(text, 300);
        }
        return text;
    }

    function hasRuntimeMetadata(result)
    {
        if (hasText(result.providerType) == false)
        {
            return false;
        }
        if (hasText(result.providerAssemblyVersion) == false)
        {
            return false;
        }
        if (hasText(result.collectionAssemblyVersion) == false)
        {
            return false;
        }
        if (hasText(result.queryRuntimeType) == false)
        {
            return false;
        }
        return hasText(result.queryAssemblyVersion);
    }

    function hasSuccessfulTimings(result)
    {
        if (isMissing(result.timingsMs))
        {
            return false;
        }
        if (isMissing(result.timingsMs.translation))
        {
            return false;
        }
        if (isMissing(result.timingsMs.extraction))
        {
            return false;
        }
        return isMissing(result.timingsMs.cleanup) == false;
    }

    function isMissing(value)
    {
        if (value == undefined)
        {
            return true;
        }
        if (value == null)
        {
            return true;
        }
        return false;
    }

    function joinValues(values, separator)
    {
        var result = "";
        var index;
        for (index = 0; index < ArrayCount(values); index++)
        {
            if (index > 0)
            {
                result += separator;
            }
            result += "" + values[index];
        }
        return result;
    }

    function writeLog(eventName, details)
    {
        LogEvent(logName, "XQI|" + eventName + "|" + details);
    }

    executeAgent();
}

RunXQueryInspectorCompatibilityAgent();
