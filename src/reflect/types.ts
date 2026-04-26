export interface ReflectModule {
  name: string;
  interval: number;
  once: boolean;
  check(): Promise<string | null>;
}
