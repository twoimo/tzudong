import { useState, useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import Header from "./Header";
import Sidebar from "./Sidebar";

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header 
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isLoggedIn={!!session}
        onOpenAuth={() => navigate("/auth")}
        onLogout={handleLogout}
      />
      
      <div className="flex-1 flex overflow-hidden">
        <Sidebar isOpen={isSidebarOpen} />
        
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
