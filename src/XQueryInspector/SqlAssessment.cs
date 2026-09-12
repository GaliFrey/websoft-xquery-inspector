using System;
using System.Collections.Generic;

namespace XQueryInspector;

internal static class SqlAssessor
{
    private const int ContextRadius = 24;

    public static SqlAssessmentResult Assess(
        string? sql,
        IReadOnlyList<ParameterResult> parameters,
        string source,
        bool assessMssqlParameters,
        bool isMainSql)
    {
        SqlAssessmentResult assessment = new();
        if (string.IsNullOrWhiteSpace(sql))
        {
            if (isMainSql)
            {
                AddWarning(assessment, "empty-sql", "The generated SQL command is empty.",
                    source, sql ?? string.Empty, 0, 0);
            }
            return assessment;
        }

        assessment.Status = "no-obvious-issues";
        char quote = '\0';
        bool bracketedIdentifier = false;
        bool lineComment = false;
        int blockCommentDepth = 0;
        int parenthesisDepth = 0;
        List<SqlParameterOccurrence> occurrences = new();

        for (int index = 0; index < sql.Length; index++)
        {
            char current = sql[index];
            char next = index + 1 < sql.Length ? sql[index + 1] : '\0';

            if (lineComment)
            {
                if (current == '\r' || current == '\n') lineComment = false;
                continue;
            }
            if (blockCommentDepth > 0)
            {
                if (current == '/' && next == '*') { blockCommentDepth++; index++; }
                else if (current == '*' && next == '/') { blockCommentDepth--; index++; }
                continue;
            }
            if (quote != '\0')
            {
                if (current == quote)
                {
                    if (next == quote) index++;
                    else quote = '\0';
                }
                continue;
            }
            if (bracketedIdentifier)
            {
                if (current == ']')
                {
                    if (next == ']') { index++; continue; }
                    bracketedIdentifier = false;
                    if (next == '[')
                    {
                        AddWarning(assessment, "adjacent-bracketed-identifiers",
                            "Bracketed identifiers are adjacent without an operator or separator.",
                            source, sql, index, 1);
                    }
                    else if (next == '@')
                    {
                        AddWarning(assessment, "parameter-without-operator",
                            "A parameter follows a bracketed identifier without an operator.",
                            source, sql, index, 1);
                    }
                }
                continue;
            }

            if (current == '-' && next == '-') { lineComment = true; index++; }
            else if (current == '/' && next == '*') { blockCommentDepth = 1; index++; }
            else if (current == '\'' || current == '"') quote = current;
            else if (current == '[') bracketedIdentifier = true;
            else if (current == '(') parenthesisDepth++;
            else if (current == ')')
            {
                if (parenthesisDepth == 0)
                {
                    AddWarning(assessment, "unexpected-closing-parenthesis",
                        "A closing parenthesis has no matching opening parenthesis.",
                        source, sql, index, 1);
                }
                else parenthesisDepth--;
            }
            else if (assessMssqlParameters
                && current == '@'
                && (index == 0 || sql[index - 1] != '@')
                && IsParameterStart(next))
            {
                int finish = index + 2;
                while (finish < sql.Length && IsParameterPart(sql[finish])) finish++;
                occurrences.Add(new SqlParameterOccurrence(sql.Substring(index, finish - index), index));
                index = finish - 1;
            }
        }

        if (quote != '\0')
            AddWarning(assessment, "unterminated-quoted-value",
                "A quoted string or identifier is not terminated.", source, sql, sql.Length - 1, 1);
        if (bracketedIdentifier)
            AddWarning(assessment, "unterminated-bracketed-identifier",
                "A bracketed identifier is not terminated.", source, sql, sql.Length - 1, 1);
        if (blockCommentDepth > 0)
            AddWarning(assessment, "unterminated-comment",
                "A block comment is not terminated.", source, sql, sql.Length - 1, 1);
        if (parenthesisDepth > 0)
            AddWarning(assessment, "unclosed-parenthesis",
                "One or more opening parentheses are not closed.", source, sql, sql.Length - 1, 1);

        if (assessMssqlParameters)
            AssessParameters(assessment, sql, parameters, source, occurrences, isMainSql);
        return assessment;
    }

    private static void AssessParameters(
        SqlAssessmentResult assessment,
        string sql,
        IReadOnlyList<ParameterResult> parameters,
        string source,
        List<SqlParameterOccurrence> occurrences,
        bool reportUnused)
    {
        Dictionary<string, List<ParameterResult>> commandParameters =
            new(StringComparer.OrdinalIgnoreCase);
        foreach (ParameterResult parameter in parameters)
        {
            string name = parameter.Name ?? string.Empty;
            if (!commandParameters.TryGetValue(name, out List<ParameterResult>? matching))
            {
                matching = new List<ParameterResult>();
                commandParameters.Add(name, matching);
            }
            matching.Add(parameter);
        }

        HashSet<string> mentioned = new(StringComparer.OrdinalIgnoreCase);
        HashSet<string> reportedMissing = new(StringComparer.OrdinalIgnoreCase);
        foreach (SqlParameterOccurrence occurrence in occurrences)
        {
            mentioned.Add(occurrence.Name);
            if (!commandParameters.ContainsKey(occurrence.Name) && reportedMissing.Add(occurrence.Name))
            {
                AddWarning(assessment, "missing-command-parameter",
                    "SQL parameter " + occurrence.Name + " is missing from the command parameters.",
                    source, sql, occurrence.Offset, occurrence.Name.Length);
            }
        }

        if (!reportUnused) return;
        foreach (KeyValuePair<string, List<ParameterResult>> entry in commandParameters)
        {
            string displayName = entry.Value[0].Name ?? string.Empty;
            if (!mentioned.Contains(entry.Key))
                AddParameterWarning(assessment, "unused-command-parameter",
                    "Command parameter " + displayName + " is not used in the main SQL.", source);
            if (entry.Value.Count > 1)
                AddParameterWarning(assessment, "duplicate-command-parameter",
                    "Command parameter " + displayName + " occurs more than once.", source);
        }
    }

    private static bool IsParameterStart(char value) =>
        value == '_' || (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z');

    private static bool IsParameterPart(char value) =>
        IsParameterStart(value) || (value >= '0' && value <= '9');

    private static void AddParameterWarning(
        SqlAssessmentResult assessment, string code, string message, string source)
    {
        assessment.Status = "warning";
        assessment.Warnings.Add(new SqlWarningResult
        {
            Code = code,
            Message = message,
            Severity = "warning",
            Source = source
        });
    }

    private static void AddWarning(
        SqlAssessmentResult assessment,
        string code,
        string message,
        string source,
        string sql,
        int offset,
        int warningLength)
    {
        int start = Math.Max(0, offset - ContextRadius);
        int fragmentLength = Math.Min(sql.Length - start, ContextRadius * 2);
        (int line, int column) = GetLineAndColumn(sql, offset);
        assessment.Status = "warning";
        assessment.Warnings.Add(new SqlWarningResult
        {
            Code = code,
            Message = message,
            Severity = "warning",
            Source = source,
            Offset = offset,
            StartOffset = offset,
            Length = warningLength,
            Line = line,
            Column = column,
            Fragment = sql.Substring(start, fragmentLength).Replace('\r', ' ').Replace('\n', ' ')
        });
    }

    private static (int Line, int Column) GetLineAndColumn(string sql, int offset)
    {
        int line = 1;
        int column = 1;
        for (int index = 0; index < offset && index < sql.Length; index++)
        {
            if (sql[index] == '\r')
            {
                if (index + 1 < offset && sql[index + 1] == '\n') index++;
                line++;
                column = 1;
            }
            else if (sql[index] == '\n') { line++; column = 1; }
            else column++;
        }
        return (line, column);
    }
}

internal sealed class SqlParameterOccurrence
{
    public SqlParameterOccurrence(string name, int offset) { Name = name; Offset = offset; }
    public string Name { get; }
    public int Offset { get; }
}

internal sealed class SqlAssessmentResult
{
    public string Status { get; set; } = "not-available";
    public bool SyntaxValidated => false;
    public List<SqlWarningResult> Warnings { get; } = new();
}

internal sealed class SqlWarningResult
{
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public int? Offset { get; set; }
    public int? StartOffset { get; set; }
    public int? Length { get; set; }
    public int? Line { get; set; }
    public int? Column { get; set; }
    public string Fragment { get; set; } = string.Empty;
}
