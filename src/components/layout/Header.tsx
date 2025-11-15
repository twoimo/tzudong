import { Menu, Moon, Sun, Bell, Maximize, User, LogOut, X, CheckCheck, AlignCenter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onToggleSidebar: () => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  onProfileClick?: () => void;
  isCenteredLayout?: boolean;
  onToggleCenteredLayout?: () => void;
}

const Header = ({ onToggleSidebar, isLoggedIn, onOpenAuth, onLogout, onProfileClick, isCenteredLayout = false, onToggleCenteredLayout }: HeaderProps) => {
  const [isDark, setIsDark] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification } = useNotifications();

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

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return '📢';
      case 'new_restaurant':
        return '🍽️';
      case 'review_approved':
        return '✅';
      case 'review_rejected':
        return '❌';
      case 'user_ranking':
        return '🏆';
      default:
        return '🔔';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return 'bg-blue-500';
      case 'new_restaurant':
        return 'bg-green-500';
      case 'review_approved':
        return 'bg-emerald-500';
      case 'review_rejected':
        return 'bg-red-500';
      case 'user_ranking':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="hover:bg-accent relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>알림</span>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-6 px-2 text-xs"
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  모두 읽음
                </Button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ScrollArea className="h-96">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  새로운 알림이 없습니다
                </div>
              ) : (
                <DropdownMenuGroup>
                  {notifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className={`flex-col items-start p-4 cursor-pointer ${!notification.isRead ? 'bg-accent/50' : ''
                        }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex items-start justify-between w-full mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                          <span className="font-medium text-sm">{notification.title}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notification.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(notification.createdAt, {
                            addSuffix: true,
                            locale: ko
                          })}
                        </span>
                        {!notification.isRead && (
                          <div className={`w-2 h-2 rounded-full ${getNotificationColor(notification.type)}`} />
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Centered Layout 버튼 */}
        {onToggleCenteredLayout && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "hover:bg-accent",
              isCenteredLayout && "bg-accent"
            )}
            onClick={onToggleCenteredLayout}
          >
            <AlignCenter className="h-5 w-5" />
          </Button>
        )}

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
};

export default Header;
