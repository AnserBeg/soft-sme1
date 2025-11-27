import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Calendar, CalendarDays, User, Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { leaveManagementAPI, timeTrackingAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

interface LeaveRequest {
  request_id: number;
  profile_id: number;
  request_type: 'vacation' | 'sick' | 'personal' | 'bereavement';
  start_date: string;
  end_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'denied' | 'modified';
  total_days: number;
  profile_name: string;
  created_at: string;
  admin_notes?: string;
}

interface Profile {
  id: number;
  name: string;
  vacation_days_available: number;
}

interface CalendarDay {
  date: Date;
  isToday: boolean;
  isCurrentWeek: boolean;
  hasTimeOff: boolean;
  timeOffProfiles: string[];
}

export const LeaveManagementScreen: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.access_role === 'Admin';
  
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [requestType, setRequestType] = useState<'vacation' | 'sick' | 'personal' | 'bereavement'>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [proposedStartDate, setProposedStartDate] = useState('');
  const [proposedEndDate, setProposedEndDate] = useState('');
  const [showAdminModal, setShowAdminModal] = useState<{
    show: boolean;
    requestId: number;
    action: 'approve' | 'deny' | 'propose';
    currentDays?: number;
  }>({ show: false, requestId: 0, action: 'approve' });

  // Modal for user actions on modified requests
  const [showUserActionModal, setShowUserActionModal] = useState<{
    show: boolean;
    requestId: number;
    action: 'accept' | 'resend';
  }>({ show: false, requestId: 0, action: 'accept' });

  // Resend form state
  const [resendFormData, setResendFormData] = useState<{
    request_type: 'vacation' | 'sick' | 'personal' | 'bereavement';
    start_date: string;
    end_date: string;
    reason: string;
  }>({
    request_type: 'vacation',
    start_date: '',
    end_date: '',
    reason: ''
  });

  // Calendar state
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    return startOfWeek;
  });

  // Request filter state
  const [showPendingOnly, setShowPendingOnly] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      console.log('=== LEAVE MANAGEMENT FETCHING DATA ===');
      console.log('User ID:', user?.id);
      console.log('User role:', user?.access_role);
      console.log('Is admin:', isAdmin);
      
      const [requestsData, profilesData] = await Promise.all([
        isAdmin ? leaveManagementAPI.getAllRequests() : leaveManagementAPI.getMyRequests(),
        timeTrackingAPI.getProfiles()
      ]);
      
      console.log('=== LEAVE MANAGEMENT RAW API RESPONSES ===');
      console.log('Leave requests API response:', requestsData);
      console.log('Profiles API response:', profilesData);
      
      console.log('=== LEAVE MANAGEMENT PROCESSED DATA ===');
      console.log('Leave requests count:', requestsData?.length || 0);
      console.log('Profiles count:', profilesData?.length || 0);
      
      if (requestsData && Array.isArray(requestsData)) {
        console.log('Sample leave request:', requestsData[0]);
      }
      
      setLeaveRequests(requestsData || []);
      setProfiles(profilesData || []);
      
      if (profilesData?.length > 0 && !selectedProfile) {
        setSelectedProfile(profilesData[0].id.toString());
      }
    } catch (error: any) {
      console.error('Leave management fetch error:', error);
      toast({
        title: "Failed to load data",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    }
  };

  // Calendar helper functions
  const getWeekDays = (): CalendarDay[] => {
    const days: CalendarDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + i);
      
      const isToday = date.getTime() === today.getTime();
      const isCurrentWeek = date >= currentWeekStart && date < new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // Check if anyone has time off on this day
      const timeOffProfiles = leaveRequests
        .filter(request => 
          request.status === 'approved' && 
          new Date(request.start_date) <= date && 
          new Date(request.end_date) >= date
        )
        .map(request => request.profile_name);
      
      days.push({
        date,
        isToday,
        isCurrentWeek,
        hasTimeOff: timeOffProfiles.length > 0,
        timeOffProfiles
      });
    }
    
    return days;
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeekStart = new Date(currentWeekStart);
    if (direction === 'prev') {
      newWeekStart.setDate(currentWeekStart.getDate() - 7);
    } else {
      newWeekStart.setDate(currentWeekStart.getDate() + 7);
    }
    setCurrentWeekStart(newWeekStart);
  };

  const goToCurrentWeek = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    setCurrentWeekStart(startOfWeek);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatDayName = (date: Date) => {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  // Get profiles with time off in the current week
  const getProfilesWithTimeOff = () => {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);
    
    return leaveRequests
      .filter(request => 
        request.status === 'approved' && 
        new Date(request.start_date) <= weekEnd && 
        new Date(request.end_date) >= currentWeekStart
      )
      .map(request => ({
        profileName: request.profile_name,
        startDate: new Date(request.start_date),
        endDate: new Date(request.end_date),
        requestType: request.request_type,
        reason: request.reason
      }))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  };

  // Get current month's leave information
  const getCurrentMonthLeaveInfo = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0);
    
    const monthLeaveRequests = leaveRequests
      .filter(request => 
        request.status === 'approved' && 
        new Date(request.start_date) <= monthEnd && 
        new Date(request.end_date) >= monthStart
      )
      .map(request => ({
        profileName: request.profile_name,
        startDate: new Date(request.start_date),
        endDate: new Date(request.end_date),
        requestType: request.request_type
      }))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    return monthLeaveRequests;
  };

  // Format leave information for display
  const formatLeaveInfo = () => {
    const monthLeave = getCurrentMonthLeaveInfo();
    
    if (monthLeave.length === 0) {
      return "No employees on leave this month";
    }
    
    const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    // Group by employee and format their leave periods
    const employeeLeaveMap = new Map();
    
    monthLeave.forEach(leave => {
      if (!employeeLeaveMap.has(leave.profileName)) {
        employeeLeaveMap.set(leave.profileName, []);
      }
      employeeLeaveMap.get(leave.profileName).push(leave);
    });
    
    const formattedLeave = Array.from(employeeLeaveMap.entries()).map(([name, leaves]) => {
      const leavePeriods = leaves.map(leave => {
        const startStr = leave.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endStr = leave.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${startStr}-${endStr}`;
      }).join(', ');
      
      return `${name}: ${leavePeriods}`;
    });
    
    return formattedLeave.slice(0, 3).join(' • '); // Show first 3 employees
  };

  const handleSubmitRequest = async () => {
    if (!selectedProfile || !startDate || !endDate) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Validate that end date is not before start date
    if (new Date(endDate) < new Date(startDate)) {
      toast({
        title: "Invalid Dates",
        description: "End date cannot be before start date",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await leaveManagementAPI.submitRequest({
        profile_id: parseInt(selectedProfile),
        request_type: requestType,
        start_date: startDate,
        end_date: endDate,
        reason
      });

      toast({
        title: "Request Submitted",
        description: "Your leave request has been submitted successfully",
      });

      // Reset form
      setStartDate('');
      setEndDate('');
      setReason('');
      
      // Refresh data
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Submission Failed",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminAction = async (requestId: number, action: 'approve' | 'deny' | 'propose') => {
    if (action === 'propose') {
      setShowAdminModal({ show: true, requestId, action, currentDays: 0 });
      return;
    }
    
    setShowAdminModal({ show: true, requestId, action });
  };

  const handleUserAction = async (requestId: number, action: 'accept' | 'resend') => {
    if (action === 'resend') {
      // Find the request and populate form data
      const request = leaveRequests.find(r => r.request_id === requestId);
      if (request) {
        setResendFormData({
          request_type: request.request_type,
          start_date: request.start_date,
          end_date: request.end_date,
          reason: request.reason || ''
        });
      }
    }
    setShowUserActionModal({ show: true, requestId, action });
  };

  const submitUserAction = async () => {
    setIsLoading(true);
    try {
      const { requestId, action } = showUserActionModal;
      
      if (action === 'accept') {
        await leaveManagementAPI.acceptModifiedRequest(requestId);
        toast({
          title: "Request Accepted",
          description: "You have accepted the modified leave request",
        });
      } else if (action === 'resend') {
        // Validate form data
        if (!resendFormData.start_date || !resendFormData.end_date) {
          toast({
            title: "Missing Information",
            description: "Please fill in all required fields",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        // Validate that end date is not before start date
        if (new Date(resendFormData.end_date) < new Date(resendFormData.start_date)) {
          toast({
            title: "Invalid Dates",
            description: "End date cannot be before start date",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        await leaveManagementAPI.resendRequest(requestId, resendFormData);
        toast({
          title: "Request Resent",
          description: "Your leave request has been resent to admin",
        });
      }
      
      // Reset modal state
      setShowUserActionModal({ show: false, requestId: 0, action: 'accept' });
      
      // Reset form data
      setResendFormData({
        request_type: 'vacation',
        start_date: '',
        end_date: '',
        reason: ''
      });
      
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Action Failed",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const submitAdminAction = async () => {
    setIsLoading(true);
    try {
      const { requestId, action } = showAdminModal;
      
      if (action === 'approve') {
        // Validate dates if both are provided
        if (proposedStartDate && proposedEndDate && new Date(proposedEndDate) < new Date(proposedStartDate)) {
          toast({
            title: "Invalid Dates",
            description: "Proposed end date cannot be before start date",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        
        await leaveManagementAPI.approveRequest(requestId, adminNotes, proposedStartDate || undefined, proposedEndDate || undefined);
        toast({
          title: "Request Approved",
          description: "Leave request has been approved",
        });
      } else if (action === 'deny') {
        await leaveManagementAPI.denyRequest(requestId, adminNotes);
        toast({
          title: "Request Denied",
          description: "Leave request has been denied",
        });
      } else if (action === 'propose') {
        if (!proposedStartDate || !proposedEndDate) {
          toast({
            title: "Missing Information",
            description: "Please enter both start and end dates",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        
        // Validate that end date is not before start date
        if (new Date(proposedEndDate) < new Date(proposedStartDate)) {
          toast({
            title: "Invalid Dates",
            description: "Proposed end date cannot be before start date",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        
                 await leaveManagementAPI.proposeVacationDates(requestId, proposedStartDate, proposedEndDate, adminNotes);
         toast({
           title: "Dates Proposed",
           description: "Leave dates have been proposed successfully",
         });
      }
      
      // Reset modal state
      setShowAdminModal({ show: false, requestId: 0, action: 'approve' });
      setAdminNotes('');
      setProposedStartDate('');
      setProposedEndDate('');
      
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Action Failed",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'outline' | 'default' | 'destructive' | 'secondary'> = {
      pending: 'outline',
      approved: 'default',
      denied: 'destructive',
      modified: 'secondary'
    };
    
    return (
      <Badge variant={variants[status] || 'outline'}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  const selectedProfileData = profiles.find(p => p.id.toString() === selectedProfile);

  // Filter requests based on toggle
  const filteredRequests = showPendingOnly 
    ? leaveRequests.filter(request => {
        // For non-admin users, treat modified requests as pending
        if (!isAdmin) {
          return request.status === 'pending' || request.status === 'modified';
        }
        return request.status === 'pending';
      })
    : leaveRequests;

  return (
    <div className="min-h-screen bg-gradient-background">
      {/* Screen Title */}
      <div className="bg-gradient-to-r from-gradient-primary-from to-gradient-primary-to text-primary-foreground p-4 shadow-mobile">
        <div className="flex items-center space-x-3">
          <div className="bg-white/20 p-2 rounded-lg">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Leave Management</h1>
            <p className="text-sm opacity-90">
              {formatLeaveInfo()}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Weekly Calendar View */}
        <Card className="shadow-card border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              <div className="flex items-center">
                <Calendar className="h-5 w-5 mr-2 text-primary" />
                Weekly Leave Schedule
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => navigateWeek('prev')}
                  variant="outline"
                  size="sm"
                  className="h-10 w-10 p-0 touch-manipulation"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  onClick={goToCurrentWeek}
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 touch-manipulation"
                >
                  Today
                </Button>
                <Button
                  onClick={() => navigateWeek('next')}
                  variant="outline"
                  size="sm"
                  className="h-10 w-10 p-0 touch-manipulation"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardTitle>
            <CardDescription>
              Week of {currentWeekStart.toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Table Header */}
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border p-3 text-left text-sm font-medium text-muted-foreground min-w-[140px]">
                      Employee Name
                    </th>
                    {getWeekDays().map((day, index) => (
                      <th key={index} className="border border-border p-2 text-center text-sm font-medium text-muted-foreground min-w-[70px]">
                        <div className="text-xs font-semibold">{formatDayName(day.date)}</div>
                        <div className="text-xs">{formatDate(day.date)}</div>
                        {day.isToday && (
                          <div className="text-xs text-primary font-semibold mt-1">Today</div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Only show rows for employees who have approved time off in this week */}
                  {getProfilesWithTimeOff().map((profile, index) => (
                    <tr key={index} className="hover:bg-muted/30 active:bg-muted/50">
                      <td className="border border-border p-3 text-sm font-medium">
                        {profile.profileName}
                      </td>
                      {getWeekDays().map((day, dayIndex) => {
                        const isOffOnThisDay = profile.startDate <= day.date && profile.endDate >= day.date;
                        return (
                          <td 
                            key={dayIndex} 
                            className={`border border-border p-2 text-center text-sm ${
                              isOffOnThisDay 
                                ? 'bg-red-100 text-red-800 font-medium' 
                                : 'bg-card'
                            }`}
                          >
                            {isOffOnThisDay ? (
                              <div className="text-xs">
                                <div className="font-semibold capitalize">{profile.requestType}</div>
                                {profile.reason && (
                                  <div className="text-xs opacity-75 truncate" title={profile.reason}>
                                    {profile.reason.length > 8 ? profile.reason.substring(0, 8) + '...' : profile.reason}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Show message when no employees are off */}
              {getProfilesWithTimeOff().length === 0 && (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No employees on leave this week</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profile Selection & Vacation Days */}
        {!isAdmin && (
          <Card className="shadow-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <User className="h-5 w-5 mr-2 text-primary" />
                Your Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Select Profile
                </label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="h-14 touch-manipulation">
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id.toString()}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {selectedProfileData && (
                <div className="bg-success/10 border border-success/20 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-success">Number of Vacation Days Available</span>
                    <span className="text-lg font-bold text-success">
                      {selectedProfileData.vacation_days_available}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Submit New Request */}
        {!isAdmin && (
          <Card className="shadow-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <CalendarDays className="h-5 w-5 mr-2 text-primary" />
                Submit Leave Request
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Leave Type
                  </label>
                  <Select value={requestType} onValueChange={(value: 'vacation' | 'sick' | 'personal' | 'bereavement') => setRequestType(value)}>
                    <SelectTrigger className="h-14 touch-manipulation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <SelectItem value="vacation">Vacation</SelectItem>
                      <SelectItem value="sick">Sick Day</SelectItem>
                      <SelectItem value="personal">Personal</SelectItem>
                      <SelectItem value="bereavement">Bereavement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Start Date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-14 touch-manipulation"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    End Date
                  </label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-14 touch-manipulation"
                    min={startDate}
                    disabled={!startDate}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Reason/Notes
                  </label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Optional: Add any additional notes..."
                    rows={3}
                    className="touch-manipulation"
                  />
                </div>
                
                <Button
                  onClick={handleSubmitRequest}
                  disabled={isLoading || !selectedProfile || !startDate || !endDate}
                  variant="success"
                  size="mobile"
                  className="w-full h-14 touch-manipulation"
                >
                  {isLoading ? 'Submitting...' : 'Submit Request'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Leave Requests List */}
        <Card className="shadow-card border-0">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center">
                <Clock className="h-5 w-5 mr-2 text-primary" />
                {isAdmin ? 'All Leave Requests' : 'My Leave Requests'}
              </CardTitle>
              <div className="flex items-center space-x-2">
                <Button
                  variant={showPendingOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowPendingOnly(true)}
                  className="h-8 px-3 text-xs"
                >
                  Pending
                </Button>
                <Button
                  variant={!showPendingOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowPendingOnly(false)}
                  className="h-8 px-3 text-xs"
                >
                  All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredRequests.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {showPendingOnly ? 'No pending leave requests found' : 'No leave requests found'}
                </p>
              </div>
            ) : (
              filteredRequests.map((request) => (
                <div key={request.request_id} className="border rounded-lg p-4 bg-card active:bg-muted/50 touch-manipulation">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      {getStatusBadge(request.status)}
                                           <span className="text-sm font-medium text-muted-foreground">
                       {request.request_type === 'vacation' ? 'Vacation' : 
                        request.request_type === 'sick' ? 'Sick Day' :
                        request.request_type === 'personal' ? 'Personal' :
                        request.request_type === 'bereavement' ? 'Bereavement' : 'Leave'}
                     </span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {request.total_days} day{request.total_days !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  <div className="space-y-2 mb-3">
                    <p className="font-medium">{request.profile_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(request.start_date).toLocaleDateString()} - {new Date(request.end_date).toLocaleDateString()}
                    </p>
                    {request.reason && (
                      <p className="text-sm text-muted-foreground">{request.reason}</p>
                    )}
                  </div>
                  
                  {isAdmin && request.status === 'pending' && (
                    <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
                      <Button
                        onClick={() => handleAdminAction(request.request_id, 'approve')}
                        disabled={isLoading}
                        variant="success"
                        size="sm"
                        className="flex-1 h-12 touch-manipulation"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button
                        onClick={() => handleAdminAction(request.request_id, 'deny')}
                        disabled={isLoading}
                        variant="destructive"
                        size="sm"
                        className="flex-1 h-12 touch-manipulation"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Deny
                      </Button>
                                             {request.request_type === 'vacation' && (
                         <Button
                           onClick={() => handleAdminAction(request.request_id, 'propose')}
                           disabled={isLoading}
                           variant="secondary"
                           size="sm"
                           className="flex-1 h-12 touch-manipulation"
                         >
                           <Calendar className="h-4 w-4 mr-2" />
                           Propose Days
                         </Button>
                       )}
                       
                       {/* Personal and bereavement can also have dates proposed */}
                       {(request.request_type === 'personal' || request.request_type === 'bereavement') && (
                         <Button
                           onClick={() => handleAdminAction(request.request_id, 'propose')}
                           disabled={isLoading}
                           variant="secondary"
                           size="sm"
                           className="flex-1 h-12 touch-manipulation"
                         >
                           <Calendar className="h-4 w-4 mr-2" />
                           Propose Dates
                         </Button>
                       )}
                    </div>
                  )}
                  
                  {/* User actions for modified requests */}
                  {!isAdmin && request.status === 'modified' && (
                    <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
                      <Button
                        onClick={() => handleUserAction(request.request_id, 'accept')}
                        disabled={isLoading}
                        variant="success"
                        size="sm"
                        className="flex-1 h-12 touch-manipulation"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Accept Changes
                      </Button>
                      <Button
                        onClick={() => handleUserAction(request.request_id, 'resend')}
                        disabled={isLoading}
                        variant="secondary"
                        size="sm"
                        className="flex-1 h-12 touch-manipulation"
                      >
                        <AlertCircle className="h-4 w-4 mr-2" />
                        Resend Request
                      </Button>
                    </div>
                  )}
                  
                  {/* Show admin notes if they exist */}
                  {request.admin_notes && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm font-medium text-blue-800 mb-1">Admin Notes:</p>
                      <p className="text-sm text-blue-700">{request.admin_notes}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin Action Modal */}
      {showAdminModal.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                         <h3 className="text-lg font-semibold mb-4">
               {showAdminModal.action === 'approve' ? 'Approve Request' : 
                showAdminModal.action === 'deny' ? 'Deny Request' : 'Propose Dates'}
             </h3>
            
                         <div className="space-y-4">
                                {/* Date Input for Propose/Approve */}
                 {(showAdminModal.action === 'propose' || showAdminModal.action === 'approve') && (
                   <div className="space-y-3">
                     <div>
                       <label className="text-sm font-medium text-muted-foreground mb-2 block">
                         {showAdminModal.action === 'propose' ? 'Proposed Start Date' : 'Proposed Start Date (Optional)'}
                       </label>
                       <Input
                         type="date"
                         value={proposedStartDate}
                         onChange={(e) => setProposedStartDate(e.target.value)}
                         className="h-14 touch-manipulation"
                       />
                     </div>
                     
                     <div>
                       <label className="text-sm font-medium text-muted-foreground mb-2 block">
                         {showAdminModal.action === 'propose' ? 'Proposed End Date' : 'Proposed End Date (Optional)'}
                       </label>
                       <Input
                         type="date"
                         value={proposedEndDate}
                         onChange={(e) => setProposedEndDate(e.target.value)}
                         className="h-14 touch-manipulation"
                         min={proposedStartDate}
                         disabled={!proposedStartDate}
                       />
                     </div>
                   </div>
                 )}
              
              {/* Admin Notes */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Admin Notes
                </label>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Add notes about this decision..."
                  rows={3}
                  className="touch-manipulation"
                />
              </div>
            </div>
            
            <div className="flex flex-col space-y-3 mt-6 sm:flex-row sm:space-y-0 sm:space-x-3">
                           <Button
               onClick={() => {
                 setShowAdminModal({ show: false, requestId: 0, action: 'approve' });
                 setAdminNotes('');
                 setProposedStartDate('');
                 setProposedEndDate('');
               }}
               variant="outline"
               className="flex-1 h-12 touch-manipulation"
             >
               Cancel
             </Button>
              <Button
                onClick={submitAdminAction}
                disabled={isLoading}
                variant={showAdminModal.action === 'deny' ? 'destructive' : 'default'}
                className="flex-1 h-12 touch-manipulation"
              >
                {isLoading ? 'Processing...' : 
                 showAdminModal.action === 'approve' ? 'Approve' :
                 showAdminModal.action === 'deny' ? 'Deny' : 'Propose'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* User Action Modal */}
      {showUserActionModal.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {showUserActionModal.action === 'accept' ? 'Accept Modified Request' : 'Resend Request'}
            </h3>
            
            {showUserActionModal.action === 'accept' ? (
              <>
                <p className="text-sm text-muted-foreground mb-6">
                  Are you sure you want to accept the modified leave request? This will approve the request with the changes proposed by admin.
                </p>
                
                <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3">
                  <Button
                    onClick={() => {
                      setShowUserActionModal({ show: false, requestId: 0, action: 'accept' });
                    }}
                    variant="outline"
                    className="flex-1 h-12 touch-manipulation"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitUserAction}
                    disabled={isLoading}
                    variant="default"
                    className="flex-1 h-12 touch-manipulation"
                  >
                    {isLoading ? 'Processing...' : 'Accept Changes'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Edit your leave request details below. This will create a new request and cancel the current modified one.
                </p>
                
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Leave Type
                    </label>
                    <Select 
                      value={resendFormData.request_type} 
                      onValueChange={(value: 'vacation' | 'sick' | 'personal' | 'bereavement') => 
                        setResendFormData(prev => ({ ...prev, request_type: value }))
                      }
                    >
                      <SelectTrigger className="h-14 touch-manipulation">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <SelectItem value="vacation">Vacation</SelectItem>
                        <SelectItem value="sick">Sick Day</SelectItem>
                        <SelectItem value="personal">Personal</SelectItem>
                        <SelectItem value="bereavement">Bereavement</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Start Date
                    </label>
                    <Input
                      type="date"
                      value={resendFormData.start_date}
                      onChange={(e) => setResendFormData(prev => ({ ...prev, start_date: e.target.value }))}
                      className="h-14 touch-manipulation"
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      End Date
                    </label>
                    <Input
                      type="date"
                      value={resendFormData.end_date}
                      onChange={(e) => setResendFormData(prev => ({ ...prev, end_date: e.target.value }))}
                      className="h-14 touch-manipulation"
                      min={resendFormData.start_date}
                      disabled={!resendFormData.start_date}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Reason/Notes
                    </label>
                    <Textarea
                      value={resendFormData.reason}
                      onChange={(e) => setResendFormData(prev => ({ ...prev, reason: e.target.value }))}
                      placeholder="Optional: Add any additional notes..."
                      rows={3}
                      className="touch-manipulation"
                    />
                  </div>
                </div>
                
                <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3">
                  <Button
                    onClick={() => {
                      setShowUserActionModal({ show: false, requestId: 0, action: 'accept' });
                      // Reset form data
                      setResendFormData({
                        request_type: 'vacation',
                        start_date: '',
                        end_date: '',
                        reason: ''
                      });
                    }}
                    variant="outline"
                    className="flex-1 h-12 touch-manipulation"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitUserAction}
                    disabled={isLoading}
                    variant="secondary"
                    className="flex-1 h-12 touch-manipulation"
                  >
                    {isLoading ? 'Processing...' : 'Resend Request'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
