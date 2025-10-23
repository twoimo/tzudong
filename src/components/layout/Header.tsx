import React, { useState } from "react";
import { Menu, Moon, Sun, Bell, Maximize, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  onToggleSidebar: () => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  onProfileClick?: () => void;
}

const Header = React.memo<HeaderProps>(({ onToggleSidebar, isLoggedIn, onOpenAuth, onLogout, onProfileClick }) => {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => {
    // 다크모드 전환 시 모든 transition 임시 비활성화하여 즉시 적용
    const root = document.documentElement;

    // 모든 transition 비활성화
    const style = document.createElement('style');
    style.textContent = '* { transition: none !important; }';
    document.head.appendChild(style);

    setIsDark(!isDark);
    root.classList.toggle("dark");

    // 다음 프레임에서 transition 복구
    requestAnimationFrame(() => {
      document.head.removeChild(style);
    });
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

        {isLoggedIn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-accent">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onProfileClick}>
                <User className="mr-2 h-4 w-4" />
                프로필
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
});

Header.displayName = "Header";

export default Header;
