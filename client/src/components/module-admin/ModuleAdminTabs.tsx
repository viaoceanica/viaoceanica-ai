import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModuleAdminSection } from "@/lib/moduleAdminRegistry";
import { useLocation } from "wouter";

const sectionLabels: Record<ModuleAdminSection, string> = {
  home: "Visão Geral",
  imports: "Imports",
  blockers: "Bloqueios",
  "line-items": "Linhas",
  settings: "Definições",
  audit: "Auditoria",
};

export function ModuleAdminTabs({ moduleKey, currentSection, sections }: { moduleKey: string; currentSection: ModuleAdminSection; sections: ModuleAdminSection[] }) {
  const [, setLocation] = useLocation();

  return (
    <Tabs value={currentSection} className="w-full">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
        {sections.map((section) => (
          <TabsTrigger
            key={section}
            value={section}
            className="rounded-lg border px-3 py-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            onClick={() => setLocation(section === "home" ? `/dashboard/module/${moduleKey}/admin` : `/dashboard/module/${moduleKey}/admin/${section}`)}
          >
            {sectionLabels[section]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
