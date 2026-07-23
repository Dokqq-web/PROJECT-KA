export interface TestSuiteRecord {
  id: string;
  name: string;
  testCaseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TestSuiteRunRecord {
  id: string;
  suiteId: string;
  runIds: string[];
  createdAt: string;
}

export interface TestSuiteRepository {
  createSuite(record: TestSuiteRecord): void;
  updateSuite(record: TestSuiteRecord): void;
  deleteSuite(id: string): boolean;
  getSuite(id: string): TestSuiteRecord | undefined;
  listSuites(): TestSuiteRecord[];
  createRun(record: TestSuiteRunRecord): void;
  getRun(id: string): TestSuiteRunRecord | undefined;
  listRuns(): TestSuiteRunRecord[];
}
