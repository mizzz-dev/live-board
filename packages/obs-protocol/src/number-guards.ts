export {};

declare global {
  interface NumberConstructor {
    isSafeInteger(value: unknown): value is number;
  }
}
