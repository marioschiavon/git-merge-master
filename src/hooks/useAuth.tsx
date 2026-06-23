import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AppRole = "master_admin" | "company_admin" | "user";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  companyId: string | null;
  profile: { full_name: string | null; avatar_url: string | null } | null;
  loading: boolean;
  isMasterAdmin: boolean;
  isCompanyAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  roles: [],
  companyId: null,
  profile: null,
  loading: true,
  isMasterAdmin: false,
  isCompanyAdmin: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const doSignOut = async () => {
    await supabase.auth.signOut();
  };

  const fetchUserData = async (userId: string) => {
    const [rolesRes, memberRes, profileRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("company_members").select("company_id").eq("user_id", userId).limit(1).maybeSingle(),
      supabase.from("profiles").select("full_name, avatar_url").eq("user_id", userId).maybeSingle(),
    ]);

    const userRoles = rolesRes.data?.map((r) => r.role as AppRole) ?? [];
    setRoles(userRoles);
    if (profileRes.data) setProfile(profileRes.data);

    const isMaster = userRoles.includes("master_admin");

    if (memberRes.data) {
      setCompanyId(memberRes.data.company_id);

      // Check company status — block inactive companies for non-master users
      if (!isMaster) {
        const { data: company } = await supabase
          .from("companies")
          .select("status")
          .eq("id", memberRes.data.company_id)
          .maybeSingle();

        if (company?.status === "inactive") {
          toast.error("Sua empresa está inativa. Entre em contato com o administrador.");
          await doSignOut();
          return;
        }
      }
    } else {
      setCompanyId(null);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchUserData(session.user.id), 0);
        } else {
          setRoles([]);
          setCompanyId(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isMasterAdmin = roles.includes("master_admin");
  const isCompanyAdmin = roles.includes("company_admin");

  return (
    <AuthContext.Provider value={{ session, user, roles, companyId, profile, loading, isMasterAdmin, isCompanyAdmin, signOut: doSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
