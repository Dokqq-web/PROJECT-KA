import type {
  Platform,
  TestCase,
  TestStep,
  TestStepAction
} from "../domain/test-case.js";

const actions = new Set<TestStepAction>([
  "open",
  "click",
  "fill",
  "select",
  "assertText",
  "assertVisible",
  "wait",
  "apiRequest",
  "assertJson",
  "if",
  "repeat"
]);

export function parseQaBlock(input: {
  externalId: string;
  name: string;
  description?: string;
  source: "jira" | "youtrack" | "kaiten";
}): { testCase?: TestCase; error?: string } {
  const block = input.description?.match(/```qa\s*\r?\n([\s\S]*?)```/i)?.[1];
  if (!block) {
    return {
      error: `${input.externalId}: в описании отсутствует блок \`\`\`qa`
    };
  }

  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const baseUrlLine = lines.find((line) => /^baseUrl\s*=/i.test(line));
  const platformLine = lines.find((line) => /^platform\s*=/i.test(line));
  const baseUrl = baseUrlLine?.split("=").slice(1).join("=").trim();
  const platform =
    (platformLine?.split("=").slice(1).join("=").trim() as Platform | undefined) ??
    "web";
  if (!["web", "android", "ios"].includes(platform)) {
    return { error: `${input.externalId}: неизвестная платформа "${platform}"` };
  }

  const stepLines = lines.filter(
    (line) => line !== baseUrlLine && line !== platformLine
  );
  const steps: TestStep[] = [];
  for (const [index, line] of stepLines.entries()) {
    const [rawAction = "", rawTarget = "", rawValue = "", rawTimeout = ""] =
      line.split("|").map((part) => part.trim());
    const action = rawAction as TestStepAction;
    if (!actions.has(action)) {
      return {
        error: `${input.externalId}: неизвестное действие "${rawAction}" в строке ${index + 1}`
      };
    }
    const step: TestStep = { id: String(index + 1), action };
    if (rawTarget) step.target = rawTarget;
    if (rawValue) step.value = rawValue;
    if (rawTimeout) {
      const timeoutMs = Number(rawTimeout);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        return {
          error: `${input.externalId}: некорректный тайм-аут в строке ${index + 1}`
        };
      }
      step.timeoutMs = timeoutMs;
    }
    steps.push(step);
  }

  if (steps.length === 0) {
    return { error: `${input.externalId}: блок qa не содержит шагов` };
  }
  return {
    testCase: {
      id: input.externalId,
      name: input.name,
      platform,
      baseUrl,
      steps,
      source: { system: input.source, externalId: input.externalId }
    }
  };
}
