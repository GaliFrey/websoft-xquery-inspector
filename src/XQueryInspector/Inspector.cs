using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace XQueryInspector;

/// <summary>
/// Extracts the SQL command created by the active WebSoft UniBridge provider
/// without enumerating the returned document collection.
/// </summary>
public sealed class Inspector
{
    /// <summary>
    /// Maximum accepted XQuery length in Unicode scalar values.
    /// </summary>
    public const int MaxXQueryLength = 200000;

    /// <summary>
    /// Maximum number of command parameters read by one inspection.
    /// </summary>
    public const int MaxParameterCount = 10000;

    /// <summary>
    /// Maximum number of elements read from one enumerable parameter value.
    /// </summary>
    public const int MaxEnumerableElementCount = 10000;

    /// <summary>
    /// Maximum number of nested enumerable parameter values.
    /// </summary>
    public const int MaxNormalizationDepth = 16;

    /// <summary>
    /// Maximum total number of normalized parameter value nodes.
    /// </summary>
    public const int MaxNormalizedNodeCount = 100000;

    /// <summary>
    /// Maximum total Unicode scalar count in normalized string values.
    /// </summary>
    public const int MaxParameterStringCharacterCount = 1000000;

    /// <summary>
    /// Maximum length of one byte-array parameter value.
    /// </summary>
    public const int MaxByteArrayLength = 1048576;

    /// <summary>
    /// Maximum accepted execution timeout in seconds.
    /// </summary>
    public const int MaxExecutionTimeoutSeconds = 3600;

    private const int ContractVersion = 1;
    private const long MaxSafeJsonInteger = 9007199254740991L;

    private static readonly BindingFlags MemberFlags =
        BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    /// <summary>
    /// Returns the runtime type passed through the WebTutor .NET bridge.
    /// Use this method before Inspect() when diagnosing interop problems.
    /// </summary>
    public string Describe(object? value)
    {
        object? unwrapped = UnwrapObject(value);
        return unwrapped?.GetType().AssemblyQualifiedName ?? "null";
    }

    /// <summary>
    /// Inspects XQuery through the active UniBridge provider and returns JSON
    /// containing SQL, count SQL, parameters, types, and an error if one
    /// occurs. The generated SQL command is not executed.
    /// </summary>
    public string Inspect(object? provider, string? xquery)
    {
        return Inspect(provider, xquery, useBasicHierarchyPreprocessing: true);
    }

    /// <summary>
    /// Inspects XQuery and conditionally applies the legacy hierarchy
    /// preprocessing used by tools.xquery() for UNI_CAP_BASIC providers.
    /// </summary>
    public string Inspect(
        object? provider,
        string? xquery,
        bool useBasicHierarchyPreprocessing)
    {
        InspectionResult result = InspectCore(
            provider,
            xquery,
            useBasicHierarchyPreprocessing,
            execute: false,
            executionTimeoutSeconds: null);

        return SerializeResult(result);
    }

    /// <summary>
    /// Inspects XQuery, fully enumerates the returned collection without
    /// serializing its rows, and reports whether execution completed.
    /// </summary>
    public string Execute(object? provider, string? xquery)
    {
        return Execute(provider, xquery, useBasicHierarchyPreprocessing: true);
    }

    /// <summary>
    /// Executes XQuery and conditionally applies the legacy hierarchy
    /// preprocessing used by tools.xquery() for UNI_CAP_BASIC providers.
    /// </summary>
    public string Execute(
        object? provider,
        string? xquery,
        bool useBasicHierarchyPreprocessing)
    {
        InspectionResult result = InspectCore(
            provider,
            xquery,
            useBasicHierarchyPreprocessing,
            execute: true,
            executionTimeoutSeconds: null);

        return SerializeResult(result);
    }

    /// <summary>
    /// Executes XQuery with a total execution deadline and a matching
    /// per-command timeout. The timeout begins before XQuery translation;
    /// synchronous translation can only be observed, not interrupted.
    /// </summary>
    public string ExecuteWithTimeout(
        object? provider,
        string? xquery,
        long executionTimeoutSeconds)
    {
        InspectionResult result = InspectCore(
            provider,
            xquery,
            useBasicHierarchyPreprocessing: true,
            execute: true,
            executionTimeoutSeconds);

        return SerializeResult(result);
    }

    private static string SerializeResult(object result)
    {
        try
        {
            return JsonSerializer.Serialize(result, result.GetType(), JsonOptions);
        }
        catch (Exception exception)
        {
            Exception actual = UnwrapException(exception);
            return JsonSerializer.Serialize(
                new SerializationFailureResult
                {
                    ContractVersion = ContractVersion,
                    InspectorVersion = GetInspectorVersion(),
                    Operation = result is InspectionResult inspectionResult
                        ? inspectionResult.Operation
                        : "inspect",
                    ErrorType = actual.GetType().FullName,
                    Error = actual.Message
                },
                JsonOptions);
        }
    }

    private static InspectionResult InspectCore(
        object? providerValue,
        string? xquery,
        bool useBasicHierarchyPreprocessing,
        bool execute,
        long? executionTimeoutSeconds)
    {
        long totalStartedAt = Stopwatch.GetTimestamp();
        InspectionResult result = new()
        {
            ContractVersion = ContractVersion,
            InspectorVersion = GetInspectorVersion(),
            Operation = execute ? "execute" : "inspect",
            XQuery = xquery,
            TimeoutSeconds = executionTimeoutSeconds
        };

        object? collection = null;
        object? queryOwner = null;
        object? query = null;
        ExecutionTimeoutControl? timeoutControl = null;
        string failureStage = "validate-input";

        try
        {
            if (string.IsNullOrWhiteSpace(xquery))
            {
                throw new ArgumentException("XQuery must not be empty.", nameof(xquery));
            }

            if (xquery.EnumerateRunes().Count() > MaxXQueryLength)
            {
                throw new ArgumentException(
                    $"XQuery must not exceed {MaxXQueryLength} characters.",
                    nameof(xquery));
            }

            if (executionTimeoutSeconds is not null)
            {
                if (!execute
                    || executionTimeoutSeconds < 1
                    || executionTimeoutSeconds > MaxExecutionTimeoutSeconds)
                {
                    throw new ArgumentOutOfRangeException(
                        nameof(executionTimeoutSeconds),
                        $"Execution timeout must be between 1 and {MaxExecutionTimeoutSeconds} seconds.");
                }

                timeoutControl = new ExecutionTimeoutControl(executionTimeoutSeconds.Value);
            }

            failureStage = "preprocess-xquery";
            long preprocessingStartedAt = Stopwatch.GetTimestamp();
            try
            {
                result.EffectiveXQuery = PreprocessXQuery(
                    xquery,
                    useBasicHierarchyPreprocessing);
            }
            finally
            {
                result.TimingsMs.Preprocessing = GetElapsedMilliseconds(preprocessingStartedAt);
            }

            failureStage = "unwrap-provider";
            object provider = UnwrapObject(providerValue)
                ?? throw new ArgumentNullException(nameof(providerValue), "UniBridge provider is required.");

            Type providerType = provider.GetType();
            result.ProviderType = providerType.AssemblyQualifiedName;
            result.ProviderAssemblyVersion = GetAssemblyVersion(providerType);

            failureStage = "find-xquery-method";
            MethodInfo xqueryMethod = FindXQueryMethod(providerType);

            failureStage = "invoke-xquery";
            long translationStartedAt = Stopwatch.GetTimestamp();
            try
            {
                collection = xqueryMethod.Invoke(
                    provider,
                    new object[] { result.EffectiveXQuery, 0L, 0L, false, false, false });
            }
            finally
            {
                result.TimingsMs.Translation = GetElapsedMilliseconds(translationStartedAt);
            }

            if (collection is null)
            {
                throw new InvalidOperationException("UniBridge provider returned a null collection.");
            }

            Type collectionType = collection.GetType();
            result.CollectionType = collectionType.AssemblyQualifiedName;
            result.CollectionAssemblyVersion = GetAssemblyVersion(collectionType);

            long extractionStartedAt = Stopwatch.GetTimestamp();
            try
            {
                failureStage = "resolve-query";
                queryOwner = collection;
                query = GetMemberValue(queryOwner, "Query");
                if (query is not null)
                {
                    result.ReflectionPath = "collection.Query.command";
                }
                else
                {
                    queryOwner = GetMemberValue(collection, "dc")
                        ?? throw new MissingMemberException(collectionType.FullName, "dc");
                    Type innerCollectionType = queryOwner.GetType();
                    result.InnerCollectionType = innerCollectionType.AssemblyQualifiedName;
                    result.InnerCollectionAssemblyVersion = GetAssemblyVersion(innerCollectionType);
                    query = GetMemberValue(queryOwner, "Query");
                    if (query is not null)
                    {
                        result.ReflectionPath = "collection.dc.Query.command";
                    }
                }

                if (query is null)
                {
                    throw new MissingMemberException(queryOwner.GetType().FullName, "Query");
                }

                Type queryRuntimeType = query.GetType();
                result.QueryRuntimeType = queryRuntimeType.AssemblyQualifiedName;
                result.QueryAssemblyVersion = GetAssemblyVersion(queryRuntimeType);

                failureStage = "resolve-command";
                object command = GetMemberValue(query, "command")
                    ?? throw new MissingMemberException(queryRuntimeType.FullName, "command");

                if (timeoutControl is not null)
                {
                    failureStage = "configure-timeout";
                    timeoutControl.AttachCommand(command);
                    timeoutControl.ThrowIfTimedOut();
                    SetMemberValue(
                        command,
                        "CommandTimeout",
                        timeoutControl.GetRemainingCommandTimeoutSeconds());
                }

                failureStage = "read-command";
                result.Sql = Convert.ToString(
                    GetMemberValue(command, "CommandText"),
                    CultureInfo.InvariantCulture);
                result.CountSql = Convert.ToString(
                    GetMemberValue(query, "CountQueryValue"),
                    CultureInfo.InvariantCulture);
                result.QueryType = Convert.ToString(
                    GetMemberValue(query, "QueryType"),
                    CultureInfo.InvariantCulture);

                failureStage = "read-execution-settings";
                object? metadata = GetMemberValue(queryOwner, "metadata");
                object? initialSettings = metadata is null
                    ? null
                    : GetMemberValue(metadata, "InitialSesttings");
                result.SqlOffset = GetMemberValue(initialSettings, "SqlOffset") as bool?;

                object? queryOptions = GetMemberValue(query, "Options");
                object? pageSize = GetMemberValue(queryOptions, "PageSize");
                if (pageSize is not null)
                {
                    result.PageSize = Convert.ToInt64(pageSize, CultureInfo.InvariantCulture);
                }

                failureStage = "read-parameters";
                object? commandParameters = GetMemberValue(command, "Parameters");
                result.Parameters = ReadParameters(commandParameters);
            }
            finally
            {
                result.TimingsMs.Extraction = GetElapsedMilliseconds(extractionStartedAt);
            }

            if (execute)
            {
                result.ExecutionAttempted = true;
                failureStage = "execute-query";
                long executionStartedAt = Stopwatch.GetTimestamp();
                try
                {
                    result.RowsRead = EnumerateCollection(
                        collection,
                        queryOwner,
                        timeoutControl);
                    timeoutControl?.CompleteExecution();
                    timeoutControl?.ThrowIfTimedOut();
                    result.ExecutionSuccess = true;
                }
                finally
                {
                    result.TimingsMs.Execution = GetElapsedMilliseconds(executionStartedAt);
                    CaptureExecutedCommand(result, queryOwner, query);
                }
            }

            result.Success = true;
            failureStage = string.Empty;
        }
        catch (Exception exception)
        {
            Exception actual = UnwrapException(exception);
            if (timeoutControl?.HasTimedOutOrDeadlineExpired() == true)
            {
                result.TimedOut = true;
                failureStage = "execute-timeout";
                actual = new TimeoutException(
                    $"XQuery execution exceeded the {executionTimeoutSeconds} second timeout.",
                    actual);
            }
            result.Success = false;
            if (result.ExecutionAttempted && result.ExecutionSuccess is null)
            {
                result.ExecutionSuccess = false;
            }
            result.FailureStage = failureStage;
            result.ErrorType = actual.GetType().FullName;
            result.Error = actual.Message;
        }
        finally
        {
            timeoutControl?.Dispose();
            if (collection is not null)
            {
                long cleanupStartedAt = Stopwatch.GetTimestamp();
                try
                {
                    MethodInfo? terminate = FindParameterlessMethod(
                        collection.GetType(),
                        "Terminate");

                    if (terminate is null)
                    {
                        throw new MissingMethodException(collection.GetType().FullName, "Terminate");
                    }

                    terminate.Invoke(collection, null);
                }
                catch (Exception exception)
                {
                    Exception actual = UnwrapException(exception);
                    result.CleanupError = actual.GetType().FullName + ": " + actual.Message;
                    if (result.FailureStage is null)
                    {
                        result.FailureStage = "cleanup-collection";
                    }
                    result.Success = false;
                }
                finally
                {
                    result.TimingsMs.Cleanup = GetElapsedMilliseconds(cleanupStartedAt);
                }
            }

            result.TimingsMs.Total = GetElapsedMilliseconds(totalStartedAt);
        }

        return result;
    }

    private static long EnumerateCollection(
        object collection,
        object? queryOwner,
        ExecutionTimeoutControl? timeoutControl)
    {
        object cursorSource = queryOwner ?? collection;
        MethodInfo? getFirst = FindParameterlessMethod(cursorSource.GetType(), "GetFirst");
        MethodInfo? getNext = FindParameterlessMethod(cursorSource.GetType(), "GetNext");
        if ((getFirst is null) != (getNext is null))
        {
            string missingMethod = getFirst is null ? "GetFirst" : "GetNext";
            throw new MissingMethodException(cursorSource.GetType().FullName, missingMethod);
        }

        if (getFirst is not null && getNext is not null)
        {
            long count = 0;
            timeoutControl?.ThrowIfTimedOut();
            bool hasCurrent = Convert.ToBoolean(
                getFirst.Invoke(cursorSource, null),
                CultureInfo.InvariantCulture);
            while (hasCurrent)
            {
                timeoutControl?.ThrowIfTimedOut();
                checked
                {
                    count++;
                }

                timeoutControl?.ThrowIfTimedOut();
                hasCurrent = Convert.ToBoolean(
                    getNext.Invoke(cursorSource, null),
                    CultureInfo.InvariantCulture);
            }

            return count;
        }

        IEnumerable enumerable = collection as IEnumerable
            ?? cursorSource as IEnumerable
            ?? throw new InvalidOperationException(
                "XQuery collection must expose GetFirst()/GetNext() or implement IEnumerable.");
        IEnumerator enumerator = enumerable.GetEnumerator();
        try
        {
            long count = 0;
            while (true)
            {
                timeoutControl?.ThrowIfTimedOut();
                if (!enumerator.MoveNext())
                {
                    break;
                }

                _ = enumerator.Current;
                checked
                {
                    count++;
                }
            }

            return count;
        }
        finally
        {
            (enumerator as IDisposable)?.Dispose();
        }
    }

    private static MethodInfo? FindParameterlessMethod(Type type, string name)
    {
        return type.GetMethod(
            name,
            MemberFlags,
            binder: null,
            types: Type.EmptyTypes,
            modifiers: null);
    }

    private static void CaptureExecutedCommand(
        InspectionResult result,
        object? queryOwner,
        object? originalQuery)
    {
        try
        {
            object? currentQuery = GetMemberValue(queryOwner, "Query") ?? originalQuery;
            object? currentCommand = GetMemberValue(currentQuery, "command");
            if (currentCommand is null)
            {
                throw new MissingMemberException(currentQuery?.GetType().FullName, "command");
            }

            result.ExecutedSql = Convert.ToString(
                GetMemberValue(currentCommand, "CommandText"),
                CultureInfo.InvariantCulture);
            result.ExecutedParameters = ReadParameters(
                GetMemberValue(currentCommand, "Parameters"));
        }
        catch (Exception exception)
        {
            Exception actual = UnwrapException(exception);
            result.ExecutedCommandCaptureError =
                actual.GetType().FullName + ": " + actual.Message;
        }
    }

    private static string PreprocessXQuery(
        string xquery,
        bool useBasicHierarchyPreprocessing)
    {
        string effectiveXQuery = xquery
            .Replace("  ", " ", StringComparison.Ordinal)
            .Replace("  ", " ", StringComparison.Ordinal);

        if (!useBasicHierarchyPreprocessing)
        {
            return effectiveXQuery;
        }

        int conditionIndex = effectiveXQuery.IndexOf(" IsHierChild(", StringComparison.Ordinal);
        string direction = "-";
        if (conditionIndex < 0)
        {
            conditionIndex = effectiveXQuery.IndexOf(
                " IsHierChildOrSelf(",
                StringComparison.Ordinal);
            direction = "+";
        }

        if (conditionIndex <= 0)
        {
            return effectiveXQuery;
        }

        int centerIndex = conditionIndex + 17;
        int delta = 1;
        int finishIndex = effectiveXQuery.IndexOf(") and", centerIndex, StringComparison.Ordinal);
        if (finishIndex < 0)
        {
            finishIndex = effectiveXQuery.IndexOf(')', centerIndex);
        }
        else
        {
            delta = 5;
        }

        int commaIndex = effectiveXQuery.IndexOf(',', centerIndex);
        if (finishIndex < 0 || commaIndex < 0 || commaIndex >= finishIndex)
        {
            throw new FormatException("Unable to preprocess legacy hierarchy qualifier.");
        }

        string prefix = effectiveXQuery.Substring(0, conditionIndex);
        if (delta == 1)
        {
            prefix = prefix.Replace(" where", string.Empty, StringComparison.Ordinal);
        }

        string baseId = effectiveXQuery.Substring(
            commaIndex + 1,
            finishIndex - commaIndex - 1);
        string suffix = effectiveXQuery.Substring(finishIndex + delta)
            .Replace(
                "/Hier()",
                "/Hier( " + baseId + ",'" + direction + "')",
                StringComparison.Ordinal);

        return prefix + suffix;
    }

    private static string GetInspectorVersion()
    {
        Assembly assembly = typeof(Inspector).Assembly;
        string? informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        return !string.IsNullOrWhiteSpace(informationalVersion)
            ? informationalVersion
            : assembly.GetName().Version?.ToString() ?? "unknown";
    }

    private static string? GetAssemblyVersion(Type runtimeType)
    {
        try
        {
            return runtimeType.Assembly.GetName().Version?.ToString();
        }
        catch
        {
            return null;
        }
    }

    private static double GetElapsedMilliseconds(long startedAt)
    {
        return (Stopwatch.GetTimestamp() - startedAt) * 1000.0 / Stopwatch.Frequency;
    }

    private static MethodInfo FindXQueryMethod(Type providerType)
    {
        MethodInfo? method = providerType
            .GetMethods(MemberFlags)
            .FirstOrDefault(candidate =>
            {
                if (!string.Equals(candidate.Name, "XQuery", StringComparison.Ordinal))
                {
                    return false;
                }

                ParameterInfo[] parameters = candidate.GetParameters();
                return parameters.Length == 6
                    && parameters[0].ParameterType == typeof(string)
                    && parameters[1].ParameterType == typeof(long)
                    && parameters[2].ParameterType == typeof(long)
                    && parameters.Skip(3).All(parameter => parameter.ParameterType == typeof(bool));
            });

        return method
            ?? throw new MissingMethodException(
                providerType.FullName,
                "XQuery(string, long, long, bool, bool, bool)");
    }

    private static object? GetMemberValue(object? value, string name)
    {
        if (value is null)
        {
            return null;
        }

        for (Type? type = value.GetType(); type is not null; type = type.BaseType)
        {
            PropertyInfo? property = type.GetProperty(name, MemberFlags | BindingFlags.DeclaredOnly);
            if (property is not null)
            {
                return property.GetValue(value, null);
            }

            FieldInfo? field = type.GetField(name, MemberFlags | BindingFlags.DeclaredOnly);
            if (field is not null)
            {
                return field.GetValue(value);
            }
        }

        return null;
    }

    private static void SetMemberValue(object value, string name, object memberValue)
    {
        for (Type? type = value.GetType(); type is not null; type = type.BaseType)
        {
            PropertyInfo? property = type.GetProperty(name, MemberFlags | BindingFlags.DeclaredOnly);
            if (property is not null && property.CanWrite)
            {
                property.SetValue(value, memberValue, null);
                return;
            }

            FieldInfo? field = type.GetField(name, MemberFlags | BindingFlags.DeclaredOnly);
            if (field is not null)
            {
                field.SetValue(value, memberValue);
                return;
            }
        }

        throw new MissingMemberException(value.GetType().FullName, name);
    }

    private static List<ParameterResult> ReadParameters(object? parametersValue)
    {
        List<ParameterResult> parameters = new();
        if (parametersValue is not IEnumerable enumerable)
        {
            return parameters;
        }

        NormalizationContext context = new();
        int parameterCount = 0;
        foreach (object? item in enumerable)
        {
            parameterCount++;
            if (parameterCount > MaxParameterCount)
            {
                throw CreateLimitException(nameof(MaxParameterCount), MaxParameterCount);
            }

            if (item is null)
            {
                continue;
            }

            object? value = GetMemberValue(item, "Value");
            parameters.Add(new ParameterResult
            {
                Name = Convert.ToString(GetMemberValue(item, "ParameterName"), CultureInfo.InvariantCulture),
                Type = ReadParameterType(item),
                Value = NormalizeValue(value, context, depth: 0)
            });
        }

        return parameters;
    }

    private static string? ReadParameterType(object parameter)
    {
        foreach (string memberName in new[] { "NpgsqlDbType", "SqlDbType", "DbType" })
        {
            object? value = GetMemberValue(parameter, memberName);
            if (value is not null)
            {
                return FormatParameterType(memberName, value);
            }
        }

        object? parameterValue = GetMemberValue(parameter, "Value");
        return parameterValue?.GetType().FullName;
    }

    private static string? FormatParameterType(string memberName, object value)
    {
        if (value is not Enum enumValue)
        {
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        string formatted = Enum.Format(enumValue.GetType(), enumValue, "F");
        return string.Equals(memberName, "NpgsqlDbType", StringComparison.Ordinal)
            ? FormatNpgsqlDbType(formatted)
            : formatted;
    }

    private static string FormatNpgsqlDbType(string formatted)
    {
        string[] parts = formatted.Split(',');
        List<string> typeNames = new();
        bool isArray = false;

        foreach (string part in parts)
        {
            string typeName = part.Trim();
            if (string.Equals(typeName, "Array", StringComparison.OrdinalIgnoreCase))
            {
                isArray = true;
                continue;
            }

            if (typeName.Length != 0)
            {
                typeNames.Add(typeName.ToLowerInvariant());
            }
        }

        if (typeNames.Count != 1)
        {
            return formatted;
        }

        return typeNames[0] + (isArray ? "[]" : string.Empty);
    }

    private static object? NormalizeValue(
        object? value,
        NormalizationContext context,
        int depth)
    {
        context.NodeCount++;
        if (context.NodeCount > MaxNormalizedNodeCount)
        {
            throw CreateLimitException(nameof(MaxNormalizedNodeCount), MaxNormalizedNodeCount);
        }

        if (value is null || value == DBNull.Value)
        {
            return null;
        }

        if (value is byte[] bytes)
        {
            if (bytes.Length > MaxByteArrayLength)
            {
                throw CreateLimitException(nameof(MaxByteArrayLength), MaxByteArrayLength);
            }

            return Convert.ToBase64String(bytes);
        }

        if (value is long signedInteger)
        {
            if (signedInteger >= -MaxSafeJsonInteger && signedInteger <= MaxSafeJsonInteger)
            {
                return signedInteger;
            }

            return CountString(
                signedInteger.ToString(CultureInfo.InvariantCulture),
                context);
        }

        if (value is ulong unsignedInteger)
        {
            if (unsignedInteger <= (ulong)MaxSafeJsonInteger)
            {
                return unsignedInteger;
            }

            return CountString(
                unsignedInteger.ToString(CultureInfo.InvariantCulture),
                context);
        }

        if (value is decimal decimalValue)
        {
            return CountString(
                decimalValue.ToString(CultureInfo.InvariantCulture),
                context);
        }

        if (value is float singleValue)
        {
            if (float.IsNaN(singleValue))
            {
                return CountString("NaN", context);
            }

            if (float.IsPositiveInfinity(singleValue))
            {
                return CountString("Infinity", context);
            }

            if (float.IsNegativeInfinity(singleValue))
            {
                return CountString("-Infinity", context);
            }

            return singleValue;
        }

        if (value is double doubleValue)
        {
            if (double.IsNaN(doubleValue))
            {
                return CountString("NaN", context);
            }

            if (double.IsPositiveInfinity(doubleValue))
            {
                return CountString("Infinity", context);
            }

            if (double.IsNegativeInfinity(doubleValue))
            {
                return CountString("-Infinity", context);
            }

            return doubleValue;
        }

        if (value is string stringValue)
        {
            return CountString(stringValue, context);
        }

        if (value is bool
            || value is byte
            || value is sbyte
            || value is short
            || value is ushort
            || value is int
            || value is uint
            || value is DateTime
            || value is DateTimeOffset
            || value is Guid)
        {
            return value;
        }

        if (value is IEnumerable enumerable)
        {
            if (depth >= MaxNormalizationDepth)
            {
                throw CreateLimitException(nameof(MaxNormalizationDepth), MaxNormalizationDepth);
            }

            if (!context.ActiveEnumerables.Add(enumerable))
            {
                throw new ParameterNormalizationException(
                    nameof(MaxNormalizationDepth)
                        + " limit was exceeded by a cyclic enumerable structure.");
            }

            List<object?> items = new();
            try
            {
                int elementCount = 0;
                foreach (object? item in enumerable)
                {
                    elementCount++;
                    if (elementCount > MaxEnumerableElementCount)
                    {
                        throw CreateLimitException(
                            nameof(MaxEnumerableElementCount),
                            MaxEnumerableElementCount);
                    }

                    items.Add(NormalizeValue(item, context, depth + 1));
                }
            }
            finally
            {
                context.ActiveEnumerables.Remove(enumerable);
            }

            return items;
        }

        return CountString(
            Convert.ToString(value, CultureInfo.InvariantCulture),
            context);
    }

    private static string? CountString(string? value, NormalizationContext context)
    {
        if (value is null)
        {
            return null;
        }

        foreach (Rune unused in value.EnumerateRunes())
        {
            context.StringLength++;
            if (context.StringLength > MaxParameterStringCharacterCount)
            {
                throw CreateLimitException(
                    nameof(MaxParameterStringCharacterCount),
                    MaxParameterStringCharacterCount);
            }
        }

        return value;
    }

    private static ParameterNormalizationException CreateLimitException(
        string limitName,
        int limit)
    {
        return new ParameterNormalizationException(
            limitName + " limit of " + limit.ToString(CultureInfo.InvariantCulture) + " was exceeded.");
    }

    private static object? UnwrapObject(object? value)
    {
        object? current = value;

        for (int depth = 0; current is not null && depth < 3; depth++)
        {
            PropertyInfo? objectProperty = current.GetType().GetProperty(
                "Object",
                BindingFlags.Instance | BindingFlags.Public);
            if (objectProperty is null || objectProperty.GetIndexParameters().Length != 0)
            {
                break;
            }

            object? next = objectProperty.GetValue(current, null);
            if (next is null || ReferenceEquals(next, current))
            {
                break;
            }

            current = next;
        }

        return current;
    }

    private static Exception UnwrapException(Exception exception)
    {
        Exception current = exception;
        while (current is TargetInvocationException && current.InnerException is not null)
        {
            current = current.InnerException;
        }

        return current;
    }
}

internal sealed class NormalizationContext
{
    public int NodeCount { get; set; }

    public int StringLength { get; set; }

    public HashSet<object> ActiveEnumerables { get; } = new(ReferenceEqualityComparer.Instance);
}

internal sealed class ParameterNormalizationException : InvalidOperationException
{
    public ParameterNormalizationException(string message)
        : base(message)
    {
    }
}

internal sealed class ExecutionTimeoutControl : IDisposable
{
    private readonly object syncRoot = new();
    private readonly long timeoutSeconds;
    private readonly long startedAt;
    private readonly Timer timer;
    private object? command;
    private int timedOut;
    private bool disposed;

    public ExecutionTimeoutControl(long timeoutSeconds)
    {
        this.timeoutSeconds = timeoutSeconds;
        startedAt = Stopwatch.GetTimestamp();
        timer = new Timer(
            OnTimeout,
            null,
            TimeSpan.FromSeconds(timeoutSeconds),
            Timeout.InfiniteTimeSpan);
    }

    public bool IsTimedOut => Volatile.Read(ref timedOut) != 0;

    public void AttachCommand(object value)
    {
        lock (syncRoot)
        {
            if (disposed)
            {
                throw new ObjectDisposedException(nameof(ExecutionTimeoutControl));
            }

            command = value;
            if (HasTimedOutOrDeadlineExpired())
            {
                TryCancelCommand(value);
            }
        }
    }

    public int GetRemainingCommandTimeoutSeconds()
    {
        ThrowIfTimedOut();
        double remainingSeconds = timeoutSeconds - GetElapsedSeconds();
        if (remainingSeconds <= 0)
        {
            MarkTimedOut();
            ThrowIfTimedOut();
        }

        return Math.Max(1, (int)Math.Ceiling(remainingSeconds));
    }

    public void ThrowIfTimedOut()
    {
        if (HasTimedOutOrDeadlineExpired())
        {
            throw new TimeoutException(
                $"XQuery execution exceeded the {timeoutSeconds} second timeout.");
        }
    }

    public void CompleteExecution()
    {
        lock (syncRoot)
        {
            if (disposed)
            {
                return;
            }

            if (DeadlineExpired)
            {
                MarkTimedOut();
            }

            StopTimer();
        }
    }

    public bool HasTimedOutOrDeadlineExpired()
    {
        if (!IsTimedOut && DeadlineExpired)
        {
            MarkTimedOut();
        }

        return IsTimedOut;
    }

    public void Dispose()
    {
        lock (syncRoot)
        {
            if (disposed)
            {
                return;
            }

            StopTimer();
        }
    }

    private void OnTimeout(object? state)
    {
        lock (syncRoot)
        {
            if (disposed)
            {
                return;
            }

            MarkTimedOut();
            if (command is not null)
            {
                TryCancelCommand(command);
            }
        }
    }

    private bool DeadlineExpired => GetElapsedSeconds() >= timeoutSeconds;

    private double GetElapsedSeconds()
    {
        return (Stopwatch.GetTimestamp() - startedAt) / (double)Stopwatch.Frequency;
    }

    private void MarkTimedOut()
    {
        Interlocked.Exchange(ref timedOut, 1);
    }

    private void StopTimer()
    {
        disposed = true;
        timer.Dispose();
        command = null;
    }

    private static void TryCancelCommand(object value)
    {
        try
        {
            MethodInfo? cancel = value.GetType().GetMethod(
                "Cancel",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic,
                binder: null,
                types: Type.EmptyTypes,
                modifiers: null);
            cancel?.Invoke(value, null);
        }
        catch
        {
            // The execution thread observes either the provider error or the
            // timeout flag and remains responsible for collection cleanup.
        }
    }
}

internal sealed class InspectionResult
{
    public bool Success { get; set; }

    public int ContractVersion { get; set; }

    public string InspectorVersion { get; set; } = string.Empty;

    public string Operation { get; set; } = "inspect";

    public string? ProviderType { get; set; }

    public string? ProviderAssemblyVersion { get; set; }

    public string? CollectionType { get; set; }

    public string? CollectionAssemblyVersion { get; set; }

    public string? InnerCollectionType { get; set; }

    public string? InnerCollectionAssemblyVersion { get; set; }

    public string? QueryRuntimeType { get; set; }

    public string? QueryAssemblyVersion { get; set; }

    public string? QueryType { get; set; }

    public string? XQuery { get; set; }

    public string? EffectiveXQuery { get; set; }

    public string? Sql { get; set; }

    public string? CountSql { get; set; }

    public bool? SqlOffset { get; set; }

    public long? PageSize { get; set; }

    public List<ParameterResult> Parameters { get; set; } = new();

    public bool ExecutionAttempted { get; set; }

    public bool? ExecutionSuccess { get; set; }

    public long? RowsRead { get; set; }

    public long? TimeoutSeconds { get; set; }

    public bool TimedOut { get; set; }

    public string? ExecutedSql { get; set; }

    public List<ParameterResult> ExecutedParameters { get; set; } = new();

    public string? ExecutedCommandCaptureError { get; set; }

    public string? ReflectionPath { get; set; }

    public string? FailureStage { get; set; }

    public InspectionTimings TimingsMs { get; set; } = new();

    public string? ErrorType { get; set; }

    public string? Error { get; set; }

    public string? CleanupError { get; set; }
}

internal sealed class SerializationFailureResult
{
    public bool Success { get; set; }

    public int ContractVersion { get; set; }

    public string InspectorVersion { get; set; } = string.Empty;

    public string Operation { get; set; } = "inspect";

    public string FailureStage { get; set; } = "serialize-result";

    public string? ErrorType { get; set; }

    public string? Error { get; set; }
}

internal sealed class InspectionTimings
{
    public double Total { get; set; }

    public double? Preprocessing { get; set; }

    public double? Translation { get; set; }

    public double? Extraction { get; set; }

    public double? Execution { get; set; }

    public double? Cleanup { get; set; }
}

internal sealed class ParameterResult
{
    public string? Name { get; set; }

    public string? Type { get; set; }

    public object? Value { get; set; }
}
