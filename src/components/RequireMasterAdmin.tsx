import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireMasterAdmin() {
  const { isMasterAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!isMasterAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
