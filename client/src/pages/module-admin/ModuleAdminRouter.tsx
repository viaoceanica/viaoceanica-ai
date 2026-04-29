import { ModuleAdminLayout } from "@/components/module-admin/ModuleAdminLayout";
import { moduleAdminRegistry, type ModuleAdminSection } from "@/lib/moduleAdminRegistry";
import NotFound from "@/pages/NotFound";
import ContabilidadeAdminHome from "@/pages/module-admin/contabilidade/ContabilidadeAdminHome";
import ContabilidadeAdminImports from "@/pages/module-admin/contabilidade/ContabilidadeAdminImports";
import ContabilidadeAdminBlockers from "@/pages/module-admin/contabilidade/ContabilidadeAdminBlockers";
import ContabilidadeAdminLineItems from "@/pages/module-admin/contabilidade/ContabilidadeAdminLineItems";
import ContabilidadeAdminSettings from "@/pages/module-admin/contabilidade/ContabilidadeAdminSettings";
import ContabilidadeAdminAudit from "@/pages/module-admin/contabilidade/ContabilidadeAdminAudit";
import HelpdeskAdminHome from "@/pages/module-admin/helpdesk/HelpdeskAdminHome";

function resolveSection(rawSection?: string): ModuleAdminSection {
  if (!rawSection || rawSection === "admin") return "home";
  const section = rawSection as ModuleAdminSection;
  return ["home", "imports", "blockers", "line-items", "settings", "audit"].includes(section) ? section : "home";
}

export default function ModuleAdminRouter({ moduleKey, section }: { moduleKey: string; section?: string }) {
  const definition = moduleAdminRegistry[moduleKey];
  if (!definition) return <NotFound />;

  const currentSection = resolveSection(section);

  let content: React.ReactNode;
  if (moduleKey === "contabilidade") {
    switch (currentSection) {
      case "imports":
        content = <ContabilidadeAdminImports />;
        break;
      case "blockers":
        content = <ContabilidadeAdminBlockers />;
        break;
      case "line-items":
        content = <ContabilidadeAdminLineItems />;
        break;
      case "settings":
        content = <ContabilidadeAdminSettings />;
        break;
      case "audit":
        content = <ContabilidadeAdminAudit />;
        break;
      case "home":
      default:
        content = <ContabilidadeAdminHome />;
        break;
    }
  } else if (moduleKey === "helpdesk") {
    switch (currentSection) {
      case "home":
      default:
        content = <HelpdeskAdminHome />;
        break;
    }
  } else {
    return <NotFound />;
  }

  return (
    <ModuleAdminLayout moduleKey={moduleKey} currentSection={currentSection}>
      {content}
    </ModuleAdminLayout>
  );
}
