export interface SkillDefinition {
  name: string;
  description: string;
  evolvable: boolean;
  allowedTools?: string[];
  filePath: string;
  body?: string;
}
