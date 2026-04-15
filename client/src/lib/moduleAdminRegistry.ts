import { Receipt } from "lucide-react";

export type ModuleAdminSection = "home" | "imports" | "blockers" | "line-items" | "settings" | "audit";

export type ModuleAdminDefinition = {
  label: string;
  icon: React.ElementType;
  sections: ModuleAdminSection[];
};

export const moduleAdminRegistry: Record<string, ModuleAdminDefinition> = {
  contabilidade: {
    label: "Contabilidade",
    icon: Receipt,
    sections: ["home", "imports", "blockers", "line-items", "settings", "audit"],
  },
};
