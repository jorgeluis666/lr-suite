"use client";

import { supabase } from "@/utils/supabase/client";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListaPendientesModule } from "@/modules/lista-pendientes/components/lista-pendientes-module";
import type { PendingResponsibleOption } from "@/modules/lista-pendientes/types";

function getMemberDisplayName(email?: string | null) {
  const e = String(email || "").trim().toLowerCase();
  if (e.includes("diego")) return "Diego";
  if (e.includes("jorgeluis") || e.includes("jorge")) return "Jorge Luis";
  return email?.split("@")[0] || "Usuario";
}

export default function PendientesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [responsables, setResponsables] = useState<PendingResponsibleOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const currentUser = authData.user ?? null;
        setUser(currentUser);

        if (!currentUser) return;

        const { data: memberships } = await supabase
          .from("workspace_members")
          .select("workspace_id, email, orden")
          .eq("user_id", currentUser.id)
          .eq("estado", "activo")
          .order("orden", { ascending: true });

        const firstWorkspaceId = memberships?.[0]?.workspace_id ?? "";
        setWorkspaceId(firstWorkspaceId);

        if (firstWorkspaceId) {
          const { data: members } = await supabase
            .from("workspace_members")
            .select("email, orden")
            .eq("workspace_id", firstWorkspaceId)
            .eq("estado", "activo");

          setResponsables(
            (members ?? [])
              .filter((m) => m.email)
              .map((m) => ({
                email: m.email,
                nombre: getMemberDisplayName(m.email),
                orden: m.orden ?? 99,
              }))
              .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
          );
        }
      } finally {
        setLoading(false);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-600">
          No estás autenticado.{" "}
          <Link href="/" className="font-semibold text-red-700 underline">
            Inicia sesión aquí.
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ListaPendientesModule
        user={user}
        workspaceId={workspaceId}
        responsables={responsables}
      />
    </div>
  );
}
