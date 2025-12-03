import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LoginScreen } from '@/components/screens/LoginScreen';
import { TimeTrackingScreen } from '@/components/screens/TimeTrackingScreen';
import { LeaveManagementScreen } from '@/components/screens/LeaveManagementScreen';
import DocumentsScreen from '@/components/screens/DocumentsScreen';
import { Clock, Calendar, Menu, FileText, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { LoadingScreen } from '@/components/LoadingScreen';
import { AttendanceScreen } from '@/components/screens/AttendanceScreen';

const Index = () => {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<'attendance' | 'time-tracking' | 'leave-management' | 'documents'>('time-tracking');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const handleScreenChange = (screen: 'attendance' | 'time-tracking' | 'leave-management' | 'documents') => {
    setCurrentScreen(screen);
    setIsMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-background">
      {/* Mobile Navigation Header */}
      <div className="bg-gradient-to-r from-gradient-primary-from to-gradient-primary-to text-primary-foreground p-4 shadow-mobile">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 px-3 text-primary-foreground hover:bg-white/20"
            onClick={logout}
          >
            Log out
          </Button>
          
          {/* Burger Menu on the Right */}
          <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 text-primary-foreground hover:bg-white/20"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] bg-sidebar p-0">
              <SheetHeader className="p-4 border-b border-border">
                <SheetTitle className="text-left text-lg font-semibold text-sidebar-foreground">
                  Navigation
                </SheetTitle>
              </SheetHeader>
              
              <div className="p-4 space-y-4">
                {/* Navigation Menu Items */}
                <div className="space-y-2">
                  <Button
                    variant={currentScreen === 'attendance' ? 'default' : 'ghost'}
                    onClick={() => handleScreenChange('attendance')}
                    className="w-full justify-start h-12"
                  >
                    <MapPin className="h-5 w-5 mr-3" />
                    Attendance
                  </Button>
                  <Button
                    variant={currentScreen === 'time-tracking' ? 'default' : 'ghost'}
                    onClick={() => handleScreenChange('time-tracking')}
                    className="w-full justify-start h-12"
                  >
                    <Clock className="h-5 w-5 mr-3" />
                    Time Tracking
                  </Button>
                  
                  <Button
                    variant={currentScreen === 'leave-management' ? 'default' : 'ghost'}
                    onClick={() => handleScreenChange('leave-management')}
                    className="w-full justify-start h-12"
                  >
                    <Calendar className="h-5 w-5 mr-3" />
                    Leave Management
                  </Button>
                  
                  <Button
                    variant={currentScreen === 'documents' ? 'default' : 'ghost'}
                    onClick={() => handleScreenChange('documents')}
                    className="w-full justify-start h-12"
                  >
                    <FileText className="h-5 w-5 mr-3" />
                    Documents
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Screen Content */}
      {currentScreen === 'attendance' ? (
        <AttendanceScreen />
      ) : currentScreen === 'time-tracking' ? (
        <TimeTrackingScreen />
      ) : currentScreen === 'leave-management' ? (
        <LeaveManagementScreen />
      ) : (
        <DocumentsScreen />
      )}
    </div>
  );
};

export default Index;
