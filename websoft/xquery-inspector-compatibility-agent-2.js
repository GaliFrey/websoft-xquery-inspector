function RunXQueryInspectorManualChecks()
{
    var logName = "xquery_inspector_manual";
    var passed = 0;
    var failed = 0;
    var loggingEnabled = false;

    function executeChecks()
    {
        try
        {
            EnableLog(logName, true);
            loggingEnabled = true;

            writeLog("RUN", "START");

            var assembly = tools.dotnet_host.Object.GetAssembly(
                "XQueryInspector.dll"
            );
            var inspector = assembly.CreateClassObject(
                "XQueryInspector.Inspector"
            );
            var provider = tools.spxml_unibridge.Object.provider;

            checkHierarchy(inspector, provider);
            checkBoundary(inspector, provider);
            checkInvalidXQuery(inspector, provider);
        }
        catch (error)
        {
            failed++;
            writeLog("FATAL", "error=" + safeField(error));
        }
        finally
        {
            if (loggingEnabled)
            {
                writeLog(
                    "SUMMARY",
                    "passed=" + passed + "|failed=" + failed
                );
                writeLog("RUN", "END");
                EnableLog(logName, false);
            }
        }
    }

    function checkHierarchy(inspector, provider)
    {
        var childXQuery =
            "for $elem in subdivisions " +
            "where IsHierChild($elem/id, 6327975429225669221) " +
            "order by $elem/Hier() " +
            "return $elem/Fields('id', 'name')";

        var selfXQuery =
            "for $elem in subdivisions " +
            "where IsHierChildOrSelf($elem/id, 6327975429225669221) " +
            "order by $elem/Hier() " +
            "return $elem/Fields('id', 'name')";

        var childInspection = inspector.Inspect(
            provider,
            childXQuery
        );

        LogEvent(
            logName,
            "XQI-MANUAL|INSPECT|scenario=hierarchy-child" +
                "|result=" + childInspection
        );

        var selfInspection = inspector.Inspect(
            provider,
            selfXQuery
        );

        LogEvent(
            logName,
            "XQI-MANUAL|INSPECT|scenario=hierarchy-self" +
                "|result=" + selfInspection
        );

        writeLog(
            "TOOLS-XQUERY",
            "scenario=hierarchy-child|state=BEGIN"
        );

        var childRows = tools.xquery(childXQuery);

        writeLog(
            "TOOLS-XQUERY",
            "scenario=hierarchy-child|state=END" +
                "|rows=" + ArrayCount(childRows)
        );

        writeLog(
            "TOOLS-XQUERY",
            "scenario=hierarchy-self|state=BEGIN"
        );

        var selfRows = tools.xquery(selfXQuery);

        writeLog(
            "TOOLS-XQUERY",
            "scenario=hierarchy-self|state=END" +
                "|rows=" + ArrayCount(selfRows)
        );
    }

    function checkBoundary(inspector, provider)
    {
        var prefix =
            "for $elem in collaborators return $elem/id";

        var paddingLength =
            200000 - StrCharCount(prefix);

        var boundaryXQuery =
            prefix + repeatText(" ", paddingLength);

        var result = ParseJson(
            inspector.Inspect(provider, boundaryXQuery)
        );

        var success = false;

        if (StrCharCount(boundaryXQuery) == 200000)
        {
            if (result.success == true)
            {
                if (hasText(result.cleanupError) == false)
                {
                    success = true;
                }
            }
        }

        if (success)
        {
            passed++;
            writeLog(
                "PASS",
                "scenario=boundary" +
                    "|length=" + StrCharCount(boundaryXQuery)
            );
        }
        else
        {
            failed++;
            writeLog(
                "FAIL",
                "scenario=boundary" +
                    "|length=" + StrCharCount(boundaryXQuery) +
                    "|success=" + safeField(result.success) +
                    "|stage=" + safeField(result.failureStage) +
                    "|errorType=" + safeField(result.errorType) +
                    "|cleanupError=" + safeField(result.cleanupError)
            );
        }
    }

    function checkInvalidXQuery(inspector, provider)
    {
        /*
         * The unclosed string literal must be rejected by the UniBridge
         * parser. IsHierChild* is absent, so inspector preprocessing cannot
         * intercept this query before the provider invocation.
         */
        var invalidXQuery =
            "for $elem in collaborators " +
            "where $elem/fullname = 'unfinished " +
            "return $elem/id";

        var result = ParseJson(
            inspector.Inspect(provider, invalidXQuery)
        );

        var success = false;

        if (result.success == false)
        {
            if (result.failureStage == "invoke-xquery")
            {
                if (hasText(result.errorType))
                {
                    if (hasText(result.cleanupError) == false)
                    {
                        success = true;
                    }
                }
            }
        }

        if (success)
        {
            passed++;
            writeLog(
                "PASS",
                "scenario=invalid-query" +
                    "|stage=" + safeField(result.failureStage) +
                    "|errorType=" + safeField(result.errorType)
            );
        }
        else
        {
            failed++;
            writeLog(
                "FAIL",
                "scenario=invalid-query" +
                    "|success=" + safeField(result.success) +
                    "|stage=" + safeField(result.failureStage) +
                    "|errorType=" + safeField(result.errorType) +
                    "|cleanupError=" + safeField(result.cleanupError)
            );
        }
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

        var blockLength = StrCharCount(block);

        for (
            index = 0;
            index + blockLength <= count;
            index += blockLength
        )
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
            text = StrLeftCharRange(text, 300);
        }

        return text;
    }

    function writeLog(eventName, details)
    {
        LogEvent(
            logName,
            "XQI-MANUAL|" + eventName + "|" + details
        );
    }

    executeChecks();
}

RunXQueryInspectorManualChecks();
