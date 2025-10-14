export interface ActionTrace {
  tool: string;
  success: boolean;
  message: string;
  summary?: string;
  link?: string;
  link_label?: string;
  input?: any;
  output?: any;
  error?: string;
}
