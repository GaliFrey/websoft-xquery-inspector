using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using XQueryInspector;

Inspector inspector = new();
FakeProvider provider = new();
FakeWrapper wrapper = new(provider);

RunScenario("object-unwrapping", () => VerifyObjectUnwrapping(inspector, wrapper));
RunScenario(
    "reflection-collection-dc-query-command",
    () => VerifySuccessfulInspection(inspector, wrapper, provider));
RunScenario(
    "legacy-hierarchy-preprocessing",
    () => VerifyLegacyHierarchyPreprocessing(inspector, provider));
RunScenario(
    "reflection-collection-query-command",
    () => VerifyDirectCollectionPath(inspector));
RunScenario("query-execution", () => VerifyExecution(inspector));
RunScenario("failure-stages", () => VerifyFailureStages(inspector));
RunScenario("provider-parameter-types", () => VerifyProviderParameterTypes(inspector));
RunScenario(
    "special-floating-point-values",
    () => VerifySpecialFloatingPointValues(inspector));
RunScenario(
    "parameter-normalization-limits",
    () => VerifyParameterNormalizationLimits(inspector));
RunScenario("serialization-fallback", VerifySerializationFallback);
RunScenario(
    "large-integer-precision",
    () => VerifyLargeIntegerPrecision(inspector, provider));
RunScenario("invalid-input", () => VerifyInvalidInput(inspector, provider));

Console.WriteLine("Smoke tests passed for " + AppContext.TargetFrameworkName + ".");

static void RunScenario(string name, Action scenario)
{
    scenario();
    Console.WriteLine("PASS " + name);
}

static void VerifyObjectUnwrapping(Inspector inspector, FakeWrapper wrapper)
{
    string description = inspector.Describe(wrapper);
    Assert(
        description.Contains(nameof(FakeProvider), StringComparison.Ordinal),
        "Describe() did not unwrap Object.");
}

static void VerifySuccessfulInspection(
    Inspector inspector,
    FakeWrapper wrapper,
    FakeProvider provider)
{
    string json = inspector.Inspect(
        wrapper,
        "for $elem in collaborators return $elem/id");
    JsonElement root = ParseResult(json);

    Assert(root.GetProperty("success").GetBoolean(), "Inspect() returned an error: " + json);
    Assert(root.GetProperty("contractVersion").GetInt32() == 1, "Unexpected contract version.");
    Assert(
        root.GetProperty("inspectorVersion").GetString()?.StartsWith(
            "1.4.2",
            StringComparison.Ordinal) == true,
        "Unexpected inspector version.");
    Assert(
        root.GetProperty("effectiveXQuery").GetString()
            == "for $elem in collaborators return $elem/id",
        "Unchanged XQuery must remain effective.");
    Assert(
        root.GetProperty("sql").GetString()
            == "select t_elem.id from collaborators t_elem where t_elem.id=@p0",
        "Unexpected SQL.");
    Assert(
        root.GetProperty("countSql").GetString() == "select count(*) from collaborators",
        "Unexpected count SQL.");
    Assert(root.GetProperty("sqlOffset").GetBoolean(), "SqlOffset was not read from metadata.");
    Assert(root.GetProperty("pageSize").GetInt64() == 400L, "Page size was not read from Query.Options.");
    Assert(
        root.GetProperty("innerCollectionType").GetString()
            ?.Contains(nameof(FakeCollection), StringComparison.Ordinal) == true,
        "Inner collection was not detected.");
    Assert(
        root.GetProperty("reflectionPath").GetString() == "collection.dc.Query.command",
        "Unexpected reflection path.");
    Assert(
        root.GetProperty("queryRuntimeType").GetString()
            ?.Contains(nameof(FakeQuery), StringComparison.Ordinal) == true,
        "Query runtime type was not detected.");
    AssertVersion(root, "providerAssemblyVersion");
    AssertVersion(root, "collectionAssemblyVersion");
    AssertVersion(root, "innerCollectionAssemblyVersion");
    AssertVersion(root, "queryAssemblyVersion");
    Assert(root.GetProperty("failureStage").ValueKind == JsonValueKind.Null, "Success has a failure stage.");
    Assert(
        root.GetProperty("parameters")[0].GetProperty("name").GetString() == "@p0",
        "Unexpected parameter name.");
    Assert(
        root.GetProperty("parameters")[0].GetProperty("value").GetInt64() == 1111111L,
        "Unexpected parameter value.");
    Assert(!root.TryGetProperty("sqlAssessment", out _), "SQL assessment is still exposed.");
    Assert(!root.TryGetProperty("countSqlAssessment", out _), "Count SQL assessment is still exposed.");
    Assert(
        !root.GetProperty("timingsMs").TryGetProperty("assessment", out _),
        "SQL assessment timing is still exposed.");
    Assert(provider.LastCollection?.Terminated == true, "Collection was not terminated.");
    AssertAllSuccessfulTimings(root);
}

static void VerifyLegacyHierarchyPreprocessing(Inspector inspector, FakeProvider provider)
{
    const long baseId = 6327975429225669221L;
    provider.ParameterValue = baseId;

    string childSource =
        "for $elem in subdivisions "
        + "where IsHierChild($elem/id, 6327975429225669221) "
        + "order by $elem/Hier() return $elem/Fields('id', 'name')";
    JsonElement child = ParseResult(inspector.Inspect(provider, childSource));
    string childEffective = child.GetProperty("effectiveXQuery").GetString() ?? string.Empty;
    Assert(child.GetProperty("xQuery").GetString() == childSource, "Source XQuery was changed.");
    Assert(
        childEffective
            == "for $elem in subdivisions order by $elem/Hier(  6327975429225669221,'-') return $elem/Fields('id', 'name')",
        "IsHierChild preprocessing differs from tools.xquery() 434: " + childEffective);
    Assert(provider.LastXQuery == childEffective, "Provider did not receive effective XQuery.");
    Assert(
        (child.GetProperty("sql").GetString() ?? string.Empty).Contains(
            "WHERE e.parent_object_id = @p0",
            StringComparison.Ordinal),
        "Child hierarchy SQL does not start from parent_object_id.");
    Assert(
        !(child.GetProperty("sql").GetString() ?? string.Empty).Contains(
            "ishierchild",
            StringComparison.OrdinalIgnoreCase),
        "Legacy ishierchild filter remained in SQL.");

    string selfSource =
        "for $elem in subdivisions "
        + "where IsHierChildOrSelf($elem/id, 6327975429225669221) "
        + "order by $elem/Hier() return $elem/id";
    JsonElement self = ParseResult(inspector.Inspect(provider, selfSource));
    string selfEffective = self.GetProperty("effectiveXQuery").GetString() ?? string.Empty;
    Assert(
        selfEffective
            == "for $elem in subdivisions order by $elem/Hier(  6327975429225669221,'+') return $elem/id",
        "IsHierChildOrSelf preprocessing differs from tools.xquery() 434: " + selfEffective);
    Assert(
        (self.GetProperty("sql").GetString() ?? string.Empty).Contains(
            "WHERE e.id = @p0",
            StringComparison.Ordinal),
        "Self hierarchy SQL does not include the base element.");

    string additionalConditionSource =
        "for  $elem in subdivisions where IsHierChild($elem/id, 6327975429225669221)"
        + " and $elem/name = 'Test' order by $elem/Hier() return $elem/id";
    JsonElement additional = ParseResult(inspector.Inspect(provider, additionalConditionSource));
    string additionalEffective = additional.GetProperty("effectiveXQuery").GetString() ?? string.Empty;
    Assert(
        additionalEffective
            == "for $elem in subdivisions where $elem/name = 'Test' order by $elem/Hier(  6327975429225669221,'-') return $elem/id",
        "Hierarchy preprocessing with an additional condition is incorrect: " + additionalEffective);

    JsonElement nonBasic = ParseResult(inspector.Inspect(provider, childSource, false));
    Assert(
        nonBasic.GetProperty("effectiveXQuery").GetString() == childSource,
        "Non-basic provider unexpectedly received hierarchy preprocessing.");
    Assert(provider.LastXQuery == childSource, "Non-basic provider received a changed XQuery.");

    string withoutHierSource =
        "for $elem in subdivisions "
        + "where IsHierChild($elem/id, 6327975429225669221) "
        + "return $elem/Fields('id', 'name')";
    JsonElement withoutHier = ParseResult(inspector.Inspect(provider, withoutHierSource));
    Assert(
        withoutHier.GetProperty("effectiveXQuery").GetString()
            == "for $elem in subdivisions return $elem/Fields('id', 'name')",
        "Legacy behavior without Hier() changed unexpectedly.");
}

static void VerifyDirectCollectionPath(Inspector inspector)
{
    ScenarioProvider provider = new(_ => new DirectCollection());
    JsonElement root = ParseResult(inspector.Inspect(
        provider,
        "for $elem in collaborators return $elem/id"));

    Assert(root.GetProperty("success").GetBoolean(), "Direct collection path failed.");
    Assert(
        root.GetProperty("reflectionPath").GetString() == "collection.Query.command",
        "Direct collection path was not reported.");
    Assert(
        root.GetProperty("innerCollectionType").ValueKind == JsonValueKind.Null,
        "Direct collection path must not report an inner collection.");
    Assert(
        root.GetProperty("innerCollectionAssemblyVersion").ValueKind == JsonValueKind.Null,
        "Direct collection path must not report an inner collection version.");
}

static void VerifyExecution(Inspector inspector)
{
    ExecutableCollection successfulCollection = new(throwOnMoveNext: false);
    JsonElement successful = ParseResult(inspector.Execute(
        new ScenarioProvider(_ => successfulCollection),
        "for $elem in collaborators return $elem/id"));

    Assert(successful.GetProperty("success").GetBoolean(), "Execute() returned an error.");
    Assert(successful.GetProperty("operation").GetString() == "execute", "Execution operation was not reported.");
    Assert(successful.GetProperty("executionAttempted").GetBoolean(), "Execution attempt was not reported.");
    Assert(successful.GetProperty("executionSuccess").GetBoolean(), "Successful execution was not reported.");
    Assert(successful.GetProperty("rowsRead").GetInt64() == 2L, "The full collection was not enumerated.");
    Assert(
        successful.GetProperty("executedSql").GetString() == "select id from collaborators order by id",
        "The command observed during execution was not captured.");
    Assert(successfulCollection.Terminated, "Executed collection was not terminated.");
    AssertTiming(successful, "execution", expected: true);

    EnumerableExecutableCollection enumerableCollection = new();
    JsonElement enumerable = ParseResult(inspector.Execute(
        new ScenarioProvider(_ => enumerableCollection),
        "for $elem in collaborators return $elem/id"));
    Assert(enumerable.GetProperty("success").GetBoolean(), "IEnumerable execution failed.");
    Assert(enumerable.GetProperty("rowsRead").GetInt64() == 2L, "IEnumerable was not fully read.");
    Assert(enumerableCollection.Terminated, "IEnumerable collection was not terminated.");

    ExecutableCollection failingCollection = new(throwOnMoveNext: true);
    JsonElement failed = ParseResult(inspector.Execute(
        new ScenarioProvider(_ => failingCollection),
        "for $elem in collaborators return $elem/id"));

    Assert(!failed.GetProperty("success").GetBoolean(), "Execution failure was reported as success.");
    Assert(!failed.GetProperty("executionSuccess").GetBoolean(), "Execution failure flag is incorrect.");
    Assert(failed.GetProperty("failureStage").GetString() == "execute-query", "Execution failure stage is incorrect.");
    Assert(
        failed.GetProperty("error").GetString()?.Contains("Database execution failed", StringComparison.Ordinal) == true,
        "Execution error text was not preserved.");
    Assert(
        failed.GetProperty("executedSql").GetString() == "select id from collaborators order by id",
        "Runtime command was lost after execution failure.");
    Assert(failingCollection.Terminated, "Failed collection was not terminated.");
}

static void VerifyFailureStages(Inspector inspector)
{
    ScenarioProvider preprocessProvider = new(_ => new DirectCollection());
    JsonElement preprocessing = AssertFailureStage(
        inspector.Inspect(
            preprocessProvider,
            "for $elem in subdivisions where IsHierChild($elem/id, 1 return $elem"),
        "preprocess-xquery");
    Assert(preprocessProvider.CallCount == 0, "Failed preprocessing invoked XQuery().");
    AssertTiming(preprocessing, "preprocessing", expected: true);
    AssertTiming(preprocessing, "translation", expected: false);

    AssertFailureStage(
        inspector.Inspect(new ThrowingWrapper(), "for $elem in collaborators return $elem/id"),
        "unwrap-provider");
    AssertFailureStage(
        inspector.Inspect(new NoXQueryProvider(), "for $elem in collaborators return $elem/id"),
        "find-xquery-method");
    JsonElement invocation = AssertFailureStage(
        inspector.Inspect(new ThrowingProvider(), "for $elem in collaborators return $elem/id"),
        "invoke-xquery");
    AssertTiming(invocation, "translation", expected: true);
    AssertTiming(invocation, "extraction", expected: false);

    ScenarioProvider missingQueryProvider = new(_ => new MissingQueryCollection());
    JsonElement missingQuery = AssertFailureStage(
        inspector.Inspect(missingQueryProvider, "for $elem in collaborators return $elem/id"),
        "resolve-query");
    AssertTiming(missingQuery, "extraction", expected: true);
    Assert(missingQueryProvider.LastCollectionTerminated, "Resolve-query failure was not cleaned up.");

    AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new DirectCollection(new QueryWithoutCommand())),
            "for $elem in collaborators return $elem/id"),
        "resolve-command");
    AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new DirectCollection(new QueryWithThrowingCommandText())),
            "for $elem in collaborators return $elem/id"),
        "read-command");
    AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new DirectCollection(new QueryWithThrowingParameters())),
            "for $elem in collaborators return $elem/id"),
        "read-parameters");

    JsonElement cleanupOnly = AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new DirectCollection(throwOnTerminate: true)),
            "for $elem in collaborators return $elem/id"),
        "cleanup-collection");
    Assert(cleanupOnly.GetProperty("error").ValueKind == JsonValueKind.Null, "Cleanup replaced the main error.");
    Assert(
        cleanupOnly.GetProperty("cleanupError").GetString()?.Contains(
            "Cleanup failed",
            StringComparison.Ordinal) == true,
        "Cleanup error was not returned.");
    AssertTiming(cleanupOnly, "cleanup", expected: true);

    JsonElement combined = AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new ThrowingQueryAndCleanupCollection()),
            "for $elem in collaborators return $elem/id"),
        "resolve-query");
    Assert(
        combined.GetProperty("cleanupError").GetString()?.Contains(
            "Cleanup failed",
            StringComparison.Ordinal) == true,
        "Secondary cleanup error was not preserved.");

    AssertFailureStage(
        inspector.Inspect(
            new ScenarioProvider(_ => new CollectionWithoutTerminate()),
            "for $elem in collaborators return $elem/id"),
        "cleanup-collection");

}

static void VerifyLargeIntegerPrecision(Inspector inspector, FakeProvider provider)
{
    provider.Sql = "select t_elem.id from collaborators t_elem where t_elem.id=@p0";
    provider.ParameterValue = 6148914691236517121L;

    string json = inspector.Inspect(
        provider,
        "for $elem in collaborators "
            + "where $elem/id in 6148914691236517121 "
            + "return $elem/id");
    JsonElement root = ParseResult(json);

    Assert(root.GetProperty("success").GetBoolean(), "SQL extraction failed.");
    Assert(
        root.GetProperty("parameters")[0].GetProperty("value").ValueKind
            == JsonValueKind.String,
        "Unsafe Int64 must be serialized as a string.");
    Assert(
        root.GetProperty("parameters")[0].GetProperty("value").GetString()
            == "6148914691236517121",
        "Unsafe Int64 lost precision.");
}

static void VerifyProviderParameterTypes(Inspector inspector)
{
    FakeNpgsqlDbType varcharArray = (FakeNpgsqlDbType)(
        (int)FakeNpgsqlDbType.Array | (int)FakeNpgsqlDbType.Varchar);
    JsonElement postgres = InspectParameter(
        inspector,
        new FakeNpgsqlParameter
        {
            ParameterName = "@p0",
            NpgsqlDbType = varcharArray,
            Value = new[] { "123", "456" }
        });
    Assert(
        postgres.GetProperty("type").GetString() == "varchar[]",
        "PostgreSQL array parameter type was not normalized.");
    Assert(
        postgres.GetProperty("value")[0].GetString() == "123"
            && postgres.GetProperty("value")[1].GetString() == "456",
        "PostgreSQL array parameter JSON changed.");

    JsonElement sqlServer = InspectParameter(
        inspector,
        new FakeSqlParameter
        {
            ParameterName = "@p0",
            SqlDbType = FakeSqlDbType.BigInt,
            Value = new long[] { 123L, 456L }
        });
    Assert(
        sqlServer.GetProperty("type").GetString() == "BigInt",
        "SQL Server parameter type changed unexpectedly.");
    Assert(
        sqlServer.GetProperty("value")[0].GetInt64() == 123L
            && sqlServer.GetProperty("value")[1].GetInt64() == 456L,
        "SQL Server array parameter JSON changed.");

    JsonElement generic = InspectParameter(
        inspector,
        new FakeDbParameter
        {
            ParameterName = "@p0",
            DbType = FakeDbType.String,
            Value = "123"
        });
    Assert(
        generic.GetProperty("type").GetString() == "String",
        "Generic DbType parameter was not preserved.");
}

static void VerifySpecialFloatingPointValues(Inspector inspector)
{
    VerifyFloatingPointValues(
        inspector,
        new object[] { 1.25f, float.NaN, float.PositiveInfinity, float.NegativeInfinity });
    VerifyFloatingPointValues(
        inspector,
        new object[] { 2.5d, double.NaN, double.PositiveInfinity, double.NegativeInfinity });
}

static void VerifyFloatingPointValues(Inspector inspector, object[] values)
{
    string[] expectedSpecialValues = { "NaN", "Infinity", "-Infinity" };

    JsonElement finite = InspectParameter(
        inspector,
        new FakeDbParameter { ParameterName = "@p0", Value = values[0] });
    Assert(
        finite.GetProperty("value").ValueKind == JsonValueKind.Number,
        values[0].GetType().Name + " finite value must remain a JSON number.");
    Assert(
        finite.GetProperty("value").GetDouble() == Convert.ToDouble(values[0]),
        values[0].GetType().Name + " finite value changed.");

    for (int index = 1; index < values.Length; index++)
    {
        JsonElement special = InspectParameter(
            inspector,
            new FakeDbParameter { ParameterName = "@p0", Value = values[index] });
        Assert(
            special.GetProperty("value").ValueKind == JsonValueKind.String,
            values[index].GetType().Name + " special value must be a JSON string.");
        Assert(
            special.GetProperty("value").GetString() == expectedSpecialValues[index - 1],
            values[index].GetType().Name + " special value changed diagnostic meaning.");
    }

    JsonElement array = InspectParameter(
        inspector,
        new FakeDbParameter { ParameterName = "@p0", Value = values });
    JsonElement arrayValue = array.GetProperty("value");
    Assert(arrayValue[0].ValueKind == JsonValueKind.Number, "Finite array value must remain numeric.");
    Assert(arrayValue[0].GetDouble() == Convert.ToDouble(values[0]), "Finite array value changed.");
    for (int index = 1; index < values.Length; index++)
    {
        Assert(
            arrayValue[index].GetString() == expectedSpecialValues[index - 1],
            values[index].GetType().Name + " array value was not normalized recursively.");
    }
}

static void VerifyParameterNormalizationLimits(Inspector inspector)
{
    AssertLimitConstants();

    VerifyParameterCountLimit(inspector);
    VerifyEnumerableElementLimit(inspector);
    VerifyDepthAndCycleLimits(inspector);
    VerifyNodeLimit(inspector);
    VerifyStringLimit(inspector);
    VerifyByteArrayLimit(inspector);
    VerifyInfiniteEnumeratorDisposal(inspector);
}

static void VerifySerializationFallback()
{
    MethodInfo serializeResult = typeof(Inspector).GetMethod(
        "SerializeResult",
        BindingFlags.Static | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException("Serialization test entry point was not found.");
    string json = (string)(serializeResult.Invoke(
        null,
        new object[] { new ThrowingSerializableValue() })
        ?? throw new InvalidOperationException("Serialization test returned null."));
    JsonElement root = ParseResult(json);

    Assert(!root.GetProperty("success").GetBoolean(), "Serialization fallback reported success.");
    Assert(root.GetProperty("contractVersion").GetInt32() == 1, "Fallback contract version changed.");
    AssertVersion(root, "inspectorVersion");
    Assert(root.GetProperty("operation").GetString() == "inspect", "Fallback operation is missing.");
    Assert(
        root.GetProperty("failureStage").GetString() == "serialize-result",
        "Serialization fallback stage is missing.");
    Assert(!string.IsNullOrWhiteSpace(root.GetProperty("errorType").GetString()), "Fallback error type is missing.");
    Assert(!string.IsNullOrWhiteSpace(root.GetProperty("error").GetString()), "Fallback error is missing.");
    Assert(!root.TryGetProperty("xQuery", out _), "Fallback exposed the source XQuery.");
    Assert(!root.TryGetProperty("parameters", out _), "Fallback exposed parameter values.");
    Assert(root.EnumerateObject().Count() == 7, "Serialization fallback is not minimal.");
}

static void AssertLimitConstants()
{
    Assert(Inspector.MaxParameterCount == 10000, "Parameter limit changed.");
    Assert(Inspector.MaxEnumerableElementCount == 10000, "Enumerable limit changed.");
    Assert(Inspector.MaxNormalizationDepth == 16, "Depth limit changed.");
    Assert(Inspector.MaxNormalizedNodeCount == 100000, "Node limit changed.");
    Assert(Inspector.MaxParameterStringCharacterCount == 1000000, "String limit changed.");
    Assert(Inspector.MaxByteArrayLength == 1048576, "Byte-array limit changed.");
}

static void VerifyParameterCountLimit(Inspector inspector)
{
    object[] maximum = Enumerable.Range(0, Inspector.MaxParameterCount)
        .Select(index => (object)new FakeDbParameter
        {
            ParameterName = "@p" + index,
            Value = index
        })
        .ToArray();
    AssertSuccessfulParameters(inspector, maximum, Inspector.MaxParameterCount);

    object[] oversized = maximum
        .Append((object)new FakeDbParameter { ParameterName = "@overflow", Value = 0 })
        .ToArray();
    AssertParameterLimitFailure(inspector, oversized, nameof(Inspector.MaxParameterCount));
}

static void VerifyEnumerableElementLimit(Inspector inspector)
{
    int[] maximum = Enumerable.Range(0, Inspector.MaxEnumerableElementCount).ToArray();
    AssertSuccessfulValue(inspector, maximum);

    int[] oversized = Enumerable.Range(0, Inspector.MaxEnumerableElementCount + 1).ToArray();
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(oversized),
        nameof(Inspector.MaxEnumerableElementCount));
}

static void VerifyDepthAndCycleLimits(Inspector inspector)
{
    AssertSuccessfulValue(inspector, NestedValue(Inspector.MaxNormalizationDepth));
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(NestedValue(Inspector.MaxNormalizationDepth + 1)),
        nameof(Inspector.MaxNormalizationDepth));

    ArrayList cycle = new();
    cycle.Add(cycle);
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(cycle),
        nameof(Inspector.MaxNormalizationDepth));
}

static void VerifyNodeLimit(Inspector inspector)
{
    object[] maximum = Enumerable.Range(0, 10)
        .Select(index => (object)new FakeDbParameter
        {
            ParameterName = "@p" + index,
            Value = Enumerable.Repeat(0, 9999).ToArray()
        })
        .ToArray();
    AssertSuccessfulParameters(inspector, maximum, maximum.Length);

    object[] oversized = maximum.ToArray();
    oversized[oversized.Length - 1] = new FakeDbParameter
    {
        ParameterName = "@overflow",
        Value = Enumerable.Repeat(0, 10000).ToArray()
    };
    AssertParameterLimitFailure(
        inspector,
        oversized,
        nameof(Inspector.MaxNormalizedNodeCount));
}

static void VerifyStringLimit(Inspector inspector)
{
    string maximum = new string('a', Inspector.MaxParameterStringCharacterCount - 1) + "😀";
    AssertSuccessfulValue(inspector, maximum);

    const string secret = "NORMALIZATION_TEST_SECRET";
    string oversized = secret
        + new string('b', Inspector.MaxParameterStringCharacterCount - secret.Length)
        + "😀";
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(oversized),
        nameof(Inspector.MaxParameterStringCharacterCount),
        secret);
}

static void VerifyByteArrayLimit(Inspector inspector)
{
    AssertSuccessfulValue(inspector, new byte[Inspector.MaxByteArrayLength]);
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(new byte[Inspector.MaxByteArrayLength + 1]),
        nameof(Inspector.MaxByteArrayLength));
}

static void VerifyInfiniteEnumeratorDisposal(Inspector inspector)
{
    DisposableInfiniteEnumerable infinite = new();
    AssertParameterLimitFailure(
        inspector,
        SingleParameter(infinite),
        nameof(Inspector.MaxEnumerableElementCount));
    Assert(infinite.LastEnumerator?.Disposed == true, "Rejected iterator was not disposed.");
    Assert(
        infinite.LastEnumerator?.MoveNextCount == Inspector.MaxEnumerableElementCount + 1,
        "Infinite iterator was not stopped at the enumerable limit.");
}

static object NestedValue(int enumerableDepth)
{
    object value = "leaf";
    for (int depth = 0; depth < enumerableDepth; depth++)
    {
        value = new object[] { value };
    }

    return value;
}

static object[] SingleParameter(object? value)
{
    return new object[]
    {
        new FakeDbParameter { ParameterName = "@p0", Value = value }
    };
}

static void AssertSuccessfulValue(Inspector inspector, object? value)
{
    AssertSuccessfulParameters(inspector, SingleParameter(value), 1);
}

static void AssertSuccessfulParameters(
    Inspector inspector,
    IEnumerable parameters,
    int expectedCount)
{
    (JsonElement root, DirectCollection collection) = InspectParameters(inspector, parameters);
    Assert(root.GetProperty("success").GetBoolean(), "Boundary value was rejected.");
    Assert(
        root.GetProperty("parameters").GetArrayLength() == expectedCount,
        "Boundary parameter count changed.");
    Assert(collection.Terminated, "Successful bounded inspection was not terminated.");
}

static void AssertParameterLimitFailure(
    Inspector inspector,
    IEnumerable parameters,
    string limitName,
    string? forbiddenValue = null)
{
    (JsonElement root, DirectCollection collection) = InspectParameters(inspector, parameters);
    Assert(!root.GetProperty("success").GetBoolean(), limitName + " overflow unexpectedly succeeded.");
    Assert(
        root.GetProperty("failureStage").GetString() == "read-parameters",
        limitName + " overflow has an unexpected failure stage.");
    Assert(
        root.GetProperty("errorType").GetString()?.EndsWith(
            "ParameterNormalizationException",
            StringComparison.Ordinal) == true,
        limitName + " overflow has an unexpected error type.");
    Assert(
        root.GetProperty("error").GetString()?.Contains(limitName, StringComparison.Ordinal) == true,
        limitName + " is missing from the error.");
    Assert(
        root.GetProperty("parameters").GetArrayLength() == 0,
        limitName + " overflow exposed partial parameters.");
    Assert(collection.Terminated, limitName + " overflow did not terminate the collection.");

    if (forbiddenValue is not null)
    {
        Assert(
            !root.GetRawText().Contains(forbiddenValue, StringComparison.Ordinal),
            limitName + " overflow exposed a parameter value.");
    }
}

static (JsonElement Root, DirectCollection Collection) InspectParameters(
    Inspector inspector,
    IEnumerable parameters)
{
    DirectCollection collection = new(new QueryWithParameters(parameters));
    JsonElement root = ParseResult(inspector.Inspect(
        new ScenarioProvider(_ => collection),
        "for $elem in collaborators return $elem/id"));
    return (root, collection);
}

static JsonElement InspectParameter(Inspector inspector, object parameter)
{
    ScenarioProvider provider = new(_ => new DirectCollection(
        new QueryWithProviderParameter(parameter)));
    JsonElement root = ParseResult(inspector.Inspect(
        provider,
        "for $elem in collaborators return $elem/id"));
    Assert(root.GetProperty("success").GetBoolean(), "Provider parameter inspection failed.");
    return root.GetProperty("parameters")[0];
}

static void VerifyInvalidInput(Inspector inspector, FakeProvider provider)
{
    JsonElement root = ParseResult(inspector.Inspect(provider, " "));
    Assert(!root.GetProperty("success").GetBoolean(), "Empty XQuery must fail.");
    Assert(root.GetProperty("failureStage").GetString() == "validate-input", "Invalid input stage is missing.");
    AssertTiming(root, "preprocessing", expected: false);
    Assert(root.GetProperty("timingsMs").GetProperty("total").GetDouble() >= 0, "Total timing is missing.");

    int callsBeforeBoundaryChecks = provider.CallCount;
    JsonElement maximumLength = ParseResult(inspector.Inspect(
        provider,
        new string('x', Inspector.MaxXQueryLength)));
    Assert(maximumLength.GetProperty("success").GetBoolean(), "Maximum XQuery length was rejected.");
    Assert(
        provider.CallCount == callsBeforeBoundaryChecks + 1,
        "Maximum XQuery length did not reach the provider.");

    JsonElement oversized = ParseResult(inspector.Inspect(
        provider,
        new string('x', Inspector.MaxXQueryLength + 1)));
    Assert(!oversized.GetProperty("success").GetBoolean(), "Oversized XQuery must fail.");
    Assert(
        oversized.GetProperty("failureStage").GetString() == "validate-input",
        "Oversized XQuery has an unexpected failure stage.");
    Assert(
        oversized.GetProperty("error").GetString()?.Contains(
            Inspector.MaxXQueryLength.ToString(),
            StringComparison.Ordinal) == true,
        "Oversized XQuery error does not contain the limit.");
    AssertTiming(oversized, "preprocessing", expected: false);
    Assert(
        provider.CallCount == callsBeforeBoundaryChecks + 1,
        "Oversized XQuery reached the provider.");
}

static JsonElement ParseResult(string json)
{
    using JsonDocument document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
}

static JsonElement AssertFailureStage(string json, string expectedStage)
{
    JsonElement root = ParseResult(json);
    Assert(!root.GetProperty("success").GetBoolean(), expectedStage + " scenario unexpectedly succeeded.");
    Assert(
        root.GetProperty("failureStage").GetString() == expectedStage,
        "Expected failure stage " + expectedStage + ", got " + root.GetProperty("failureStage"));
    Assert(root.GetProperty("timingsMs").GetProperty("total").GetDouble() >= 0, "Total timing is missing.");
    return root;
}

static void AssertVersion(JsonElement root, string propertyName)
{
    Assert(
        !string.IsNullOrWhiteSpace(root.GetProperty(propertyName).GetString()),
        propertyName + " is missing.");
}

static void AssertAllSuccessfulTimings(JsonElement root)
{
    foreach (string name in new[] { "total", "preprocessing", "translation", "extraction", "cleanup" })
    {
        AssertTiming(root, name, expected: true);
    }
}

static void AssertTiming(JsonElement root, string name, bool expected)
{
    JsonElement timing = root.GetProperty("timingsMs").GetProperty(name);
    if (!expected)
    {
        Assert(timing.ValueKind == JsonValueKind.Null, name + " timing must be null.");
        return;
    }

    Assert(timing.ValueKind == JsonValueKind.Number, name + " timing must be numeric.");
    Assert(timing.GetDouble() >= 0, name + " timing must be non-negative.");
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

sealed class FakeWrapper
{
    public FakeWrapper(object value)
    {
        Object = value;
    }

    public object Object { get; }
}

sealed class ThrowingSerializableValue
{
    public string Value => throw new InvalidOperationException("Synthetic serialization failure.");
}

sealed class FakeProvider
{
    public FakeCollection? LastCollection { get; private set; }

    public string Sql { get; set; } = "select t_elem.id from collaborators t_elem where t_elem.id=@p0";

    public object ParameterValue { get; set; } = 1111111L;

    public string? LastXQuery { get; private set; }

    public int CallCount { get; private set; }

    public FakeComCollection XQuery(
        string xquery,
        long startPos,
        long pageSize,
        bool expectSingleRecord,
        bool preloadForeignElems,
        bool useCursor)
    {
        LastXQuery = xquery;
        CallCount++;
        string sql = Sql;
        List<FakeParameter> parameters = new()
        {
            new()
            {
                ParameterName = "@p0",
                DbType = "Int64",
                Value = ParameterValue
            }
        };

        if (xquery.Contains("/Hier(", StringComparison.Ordinal))
        {
            string direction = xquery.Contains("'+'", StringComparison.Ordinal) ? "+" : "-";
            sql = direction == "+"
                ? "WITH subdivisions_cte AS (SELECT id WHERE e.id = @p0) SELECT id FROM subdivisions_cte"
                : "WITH subdivisions_cte AS (SELECT id WHERE e.parent_object_id = @p0) SELECT id FROM subdivisions_cte";
            parameters.Add(new FakeParameter
            {
                ParameterName = "@p1",
                DbType = "String",
                Value = direction
            });
        }

        LastCollection = new FakeCollection
        {
            Query = new FakeQuery
            {
                QueryValue = xquery,
                QueryType = "XQuery",
                CountQueryValue = "select count(*) from collaborators",
                command = new FakeCommand
                {
                    CommandText = sql,
                    Parameters = parameters
                }
            }
        };

        return new FakeComCollection(LastCollection);
    }
}

sealed class FakeComCollection
{
    private readonly FakeCollection dc;

    public FakeComCollection(FakeCollection dc)
    {
        this.dc = dc;
    }

    public void Terminate()
    {
        dc.Terminate();
    }
}

class FakeCollectionBase
{
    protected readonly FakeMetadata metadata = new();

    public FakeQuery? Query;
}

sealed class FakeCollection : FakeCollectionBase
{
    public bool Terminated { get; private set; }

    public void Terminate()
    {
        Terminated = true;
    }
}

sealed class FakeQuery
{
    public string? QueryValue { get; set; }

    public string? CountQueryValue { get; set; }

    public string? QueryType { get; set; }

    public FakeQueryOptions Options { get; set; } = new();

    public FakeCommand? command { get; set; }
}

sealed class FakeQueryOptions
{
    public long PageSize { get; set; } = 400L;
}

sealed class FakeMetadata
{
    public FakeInitialSettings InitialSesttings { get; } = new();
}

sealed class FakeInitialSettings
{
    public bool SqlOffset { get; set; } = true;
}

sealed class FakeCommand
{
    public string? CommandText { get; set; }

    public List<FakeParameter> Parameters { get; set; } = new();
}

sealed class FakeParameter
{
    public string? ParameterName { get; set; }

    public string? DbType { get; set; }

    public object? Value { get; set; }
}

enum FakeNpgsqlDbType
{
    Varchar = 22,
    Array = int.MinValue
}

sealed class FakeNpgsqlParameter
{
    public string? ParameterName { get; set; }

    public FakeNpgsqlDbType NpgsqlDbType { get; set; }

    public object? Value { get; set; }
}

enum FakeSqlDbType
{
    BigInt
}

sealed class FakeSqlParameter
{
    public string? ParameterName { get; set; }

    public FakeSqlDbType SqlDbType { get; set; }

    public object? Value { get; set; }
}

enum FakeDbType
{
    String
}

sealed class FakeDbParameter
{
    public string? ParameterName { get; set; }

    public FakeDbType DbType { get; set; }

    public object? Value { get; set; }
}

sealed class QueryWithProviderParameter
{
    public QueryWithProviderParameter(object parameter)
    {
        command = new CommandWithProviderParameter(parameter);
    }

    public CommandWithProviderParameter command { get; }
}

sealed class CommandWithProviderParameter
{
    public CommandWithProviderParameter(object parameter)
    {
        Parameters = new[] { parameter };
    }

    public string CommandText => "select id from collaborators where id = @p0";

    public object[] Parameters { get; }
}

sealed class QueryWithParameters
{
    public QueryWithParameters(IEnumerable parameters)
    {
        command = new CommandWithParameters(parameters);
    }

    public CommandWithParameters command { get; }
}

sealed class CommandWithParameters
{
    public CommandWithParameters(IEnumerable parameters)
    {
        Parameters = parameters;
    }

    public string CommandText => "select id from collaborators";

    public IEnumerable Parameters { get; }
}

sealed class DisposableInfiniteEnumerable : IEnumerable<object>
{
    public DisposableInfiniteEnumerator? LastEnumerator { get; private set; }

    public IEnumerator<object> GetEnumerator()
    {
        LastEnumerator = new DisposableInfiniteEnumerator();
        return LastEnumerator;
    }

    IEnumerator IEnumerable.GetEnumerator()
    {
        return GetEnumerator();
    }
}

sealed class DisposableInfiniteEnumerator : IEnumerator<object>
{
    public object Current => 0;

    object IEnumerator.Current => Current;

    public bool Disposed { get; private set; }

    public int MoveNextCount { get; private set; }

    public bool MoveNext()
    {
        MoveNextCount++;
        return true;
    }

    public void Reset()
    {
        throw new NotSupportedException();
    }

    public void Dispose()
    {
        Disposed = true;
    }
}

sealed class ThrowingWrapper
{
    public object Object => throw new InvalidOperationException("Unwrap failed.");
}

sealed class NoXQueryProvider
{
}

sealed class ThrowingProvider
{
    public object XQuery(
        string xquery,
        long startPos,
        long pageSize,
        bool expectSingleRecord,
        bool preloadForeignElems,
        bool useCursor)
    {
        throw new InvalidOperationException("Translation failed.");
    }
}

sealed class ScenarioProvider
{
    private readonly Func<string, object?> factory;

    public ScenarioProvider(Func<string, object?> factory)
    {
        this.factory = factory;
    }

    public int CallCount { get; private set; }

    public object? LastCollection { get; private set; }

    public bool LastCollectionTerminated =>
        LastCollection is MissingQueryCollection collection && collection.Terminated;

    public object? XQuery(
        string xquery,
        long startPos,
        long pageSize,
        bool expectSingleRecord,
        bool preloadForeignElems,
        bool useCursor)
    {
        CallCount++;
        LastCollection = factory(xquery);
        return LastCollection;
    }
}

sealed class DirectCollection
{
    private readonly bool throwOnTerminate;

    public DirectCollection(object? query = null, bool throwOnTerminate = false)
    {
        Query = query ?? new FakeQuery
        {
            QueryType = "XQuery",
            CountQueryValue = "select count(*) from collaborators",
            command = new FakeCommand
            {
                CommandText = "select id from collaborators",
                Parameters = new List<FakeParameter>()
            }
        };
        this.throwOnTerminate = throwOnTerminate;
    }

    public object Query { get; }

    public bool Terminated { get; private set; }

    public void Terminate()
    {
        Terminated = true;
        if (throwOnTerminate)
        {
            throw new InvalidOperationException("Cleanup failed.");
        }
    }
}

sealed class ExecutableCollection
{
    private readonly bool throwOnMoveNext;
    private int position;

    public ExecutableCollection(bool throwOnMoveNext)
    {
        this.throwOnMoveNext = throwOnMoveNext;
        Query = new FakeQuery
        {
            QueryType = "XQuery",
            command = new FakeCommand
            {
                CommandText = "select id from collaborators",
                Parameters = new List<FakeParameter>()
            }
        };
    }

    public FakeQuery Query { get; }

    public bool Terminated { get; private set; }

    public bool GetFirst()
    {
        Query.command!.CommandText = "select id from collaborators order by id";
        if (throwOnMoveNext)
        {
            throw new InvalidOperationException("Database execution failed.");
        }

        position = 0;
        return true;
    }

    public bool GetNext()
    {
        position++;
        return position < 2;
    }

    public void Terminate()
    {
        Terminated = true;
    }
}

sealed class EnumerableExecutableCollection : IEnumerable<object>
{
    public FakeQuery Query { get; } = new()
    {
        QueryType = "XQuery",
        command = new FakeCommand
        {
            CommandText = "select id from collaborators",
            Parameters = new List<FakeParameter>()
        }
    };

    public bool Terminated { get; private set; }

    public IEnumerator<object> GetEnumerator()
    {
        yield return new object();
        yield return new object();
    }

    IEnumerator IEnumerable.GetEnumerator()
    {
        return GetEnumerator();
    }

    public void Terminate()
    {
        Terminated = true;
    }
}

sealed class MissingQueryCollection
{
    public bool Terminated { get; private set; }

    public void Terminate()
    {
        Terminated = true;
    }
}

sealed class QueryWithoutCommand
{
}

sealed class QueryWithThrowingCommandText
{
    public object command { get; } = new CommandWithThrowingText();
}

sealed class CommandWithThrowingText
{
    public string CommandText => throw new InvalidOperationException("Command read failed.");
}

sealed class QueryWithThrowingParameters
{
    public object command { get; } = new CommandWithThrowingParameters();
}

sealed class CommandWithThrowingParameters
{
    public string CommandText => "select id from collaborators";

    public IEnumerable<object> Parameters => new ThrowingEnumerable();
}

sealed class ThrowingEnumerable : IEnumerable<object>
{
    public IEnumerator<object> GetEnumerator()
    {
        throw new InvalidOperationException("Parameter enumeration failed.");
    }

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator()
    {
        return GetEnumerator();
    }
}

sealed class ThrowingQueryAndCleanupCollection
{
    public object Query => throw new InvalidOperationException("Query read failed.");

    public void Terminate()
    {
        throw new InvalidOperationException("Cleanup failed.");
    }
}

sealed class CollectionWithoutTerminate
{
    public object Query { get; } = new FakeQuery
    {
        QueryType = "XQuery",
        CountQueryValue = "select count(*) from collaborators",
        command = new FakeCommand
        {
            CommandText = "select id from collaborators",
            Parameters = new List<FakeParameter>()
        }
    };
}
