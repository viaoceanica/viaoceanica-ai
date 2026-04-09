import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LOGO_URL } from "@/const";
import { ArrowRight, Bot, Shield, Users, Zap } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function Home() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/">
            <img src={LOGO_URL} alt="Via Oceânica" className="h-7 invert dark:invert-0" />
          </Link>
          <nav className="flex items-center gap-3">
            {loading ? null : user ? (
              <Button onClick={() => setLocation(user.platformRole === "admin" ? "/admin" : "/dashboard")} size="sm">
                Dashboard
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setLocation("/login")}>
                  Entrar
                </Button>
                <Button size="sm" onClick={() => setLocation("/register")}>
                  Registar
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-24 lg:py-32">
        <div className="container text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-6">
            <Bot className="h-4 w-4" />
            Plataforma de IA para empresas
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl max-w-3xl mx-auto leading-tight">
            Inteligência artificial ao serviço do seu{" "}
            <span className="text-primary">negócio</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Aceda a módulos de IA especializados para a sua empresa. Gerencie equipas, controle o consumo e escale conforme as suas necessidades.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" onClick={() => setLocation("/register")} className="text-base px-8">
              Começar agora
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => setLocation("/login")} className="text-base px-8">
              Já tenho conta
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight">Tudo o que precisa, num só lugar</h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              Uma plataforma modular pensada para empresas que querem tirar partido da inteligência artificial.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Bot, title: "Módulos de IA", desc: "Ative apenas os módulos que precisa. Restauração, gestão de email e muito mais." },
              { icon: Users, title: "Gestão de equipas", desc: "Crie equipas, convide membros e partilhe recursos dentro da sua organização." },
              { icon: Zap, title: "Sistema de tokens", desc: "Controle o consumo com tokens internos e externos. Visibilidade total do uso." },
              { icon: Shield, title: "Planos flexíveis", desc: "Do Starter ao Enterprise, escolha o plano que melhor se adapta ao seu negócio." },
            ].map((f, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-card p-6 hover:shadow-sm transition-shadow">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Pronto para começar?</h2>
          <p className="mt-3 text-muted-foreground max-w-md mx-auto">
            Registe a sua empresa e comece a utilizar os módulos de IA da Via Oceânica.
          </p>
          <Button size="lg" className="mt-8 text-base px-8" onClick={() => setLocation("/register")}>
            Criar conta gratuita
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src={LOGO_URL} alt="Via Oceânica" className="h-5 invert dark:invert-0 opacity-60" />
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Via Oceânica. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
