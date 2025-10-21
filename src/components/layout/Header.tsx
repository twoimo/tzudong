import { Menu, Moon, Sun, Bell, Maximize, User, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

interface HeaderProps {
  onToggleSidebar: () => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  onAdminClick?: () => void;
}

const Header = ({ onToggleSidebar, isLoggedIn, onOpenAuth, onLogout, onAdminClick }: HeaderProps) => {
  const { isAdmin } = useAuth();
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 shadow-sm z-10">
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {isLoggedIn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-accent">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                프로필
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onAdminClick}>
                    <Settings className="mr-2 h-4 w-4" />
                    관리자 설정
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="hover:bg-accent"
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <Button variant="ghost" size="icon" className="hover:bg-accent relative">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full"></span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="hover:bg-accent"
        >
          <Maximize className="h-5 w-5" />
        </Button>

        {!isLoggedIn && (
          <Button
            onClick={onOpenAuth}
            className="ml-2 bg-gradient-primary hover:opacity-90 transition-opacity"
          >
            로그인
          </Button>
        )}
      </div>
    </header>
  );
};

export default Header;
