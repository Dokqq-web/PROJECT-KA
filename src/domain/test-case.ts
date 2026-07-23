export type Platform = "web" | "android" | "ios";

export type TestStepAction =
  | "open"
  | "click"
  | "fill"
  | "select"
  | "assertText"
  | "assertVisible"
  | "wait"
  | "apiRequest"
  | "assertJson"
  | "if"
  | "repeat"
  | "setFrame"
  | "resetFrame"
  | "clickNewTab"
  | "switchTab"
  | "uploadFile"
  | "download"
  | "mockRoute"
  | "clearMocks"
  | "screenshot";

export interface TestStep {
  id: string;
  action: TestStepAction;
  target?: string;
  value?: string;
  timeoutMs?: number;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  saveAs?: string;
  statusCode?: number;
  steps?: TestStep[];
}

export interface TestCase {
  id: string;
  name: string;
  platform: Platform;
  baseUrl?: string;
  variables?: Record<string, string>;
  steps: TestStep[];
  source?: {
    system: "manual" | "jira" | "youtrack" | "kaiten";
    externalId?: string;
  };
}

export interface StepResult {
  stepId: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  error?: string;
  artifacts?: string[];
}

export interface TestResult {
  runId: string;
  testCaseId: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  steps: StepResult[];
}
