import api from '../api/axios';

export interface LeaveRequest {
  request_id: number;
  user_id: number;
  profile_id: number;
  request_type: 'vacation' | 'sick' | 'personal' | 'bereavement';
  start_date: string;
  end_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'denied' | 'modified';
  total_days: number;
  profile_name: string;
  user_email: string;
  created_at: string;
  updated_at?: string;
  admin_notes?: string;
  admin_user_id?: number;
}

export interface Profile {
  id: number;
  name: string;
  email: string;
  vacation_days_available: number;
  total_vacation_days?: number;
  days_used?: number;
  days_remaining?: number;
  reset_date?: string;
}

export interface VacationSettings {
  reset_date: string;
  is_active: boolean;
}

export interface LeaveStatistics {
  employees_with_leave_this_month: number;
  total_days_this_month: number;
  total_days_past_12_months: number;
}

export interface LeaveHistoryMonth {
  month: string;
  vacation_days: number;
  sick_days: number;
  personal_days: number;
  bereavement_days: number;
  total_days: number;
}

export interface LeaveHistoryProfile {
  profile_id: number;
  profile_name: string;
  profile_email: string;
  months: { [key: string]: LeaveHistoryMonth };
}

export interface CalendarDay {
  date: Date;
  isToday: boolean;
  isCurrentWeek: boolean;
  hasTimeOff: boolean;
  timeOffProfiles: string[];
}

export const leaveManagementApi = {
  // Submit leave request
  submitRequest: async (data: {
    profile_id: number;
    request_type: 'vacation' | 'sick' | 'personal' | 'bereavement';
    start_date: string;
    end_date: string;
    reason?: string;
  }): Promise<LeaveRequest> => {
    const response = await api.post('/api/leave-management/request', data);
    return response.data;
  },

  // Get user's own requests
  getMyRequests: async (): Promise<LeaveRequest[]> => {
    const response = await api.get('/api/leave-management/my-requests');
    return response.data;
  },

  // Get all requests (Admin only)
  getAllRequests: async (): Promise<LeaveRequest[]> => {
    const response = await api.get('/api/leave-management/all-requests');
    return response.data;
  },

  // Get calendar data
  getCalendar: async (startDate?: string, endDate?: string): Promise<LeaveRequest[]> => {
    const params: any = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const response = await api.get('/api/leave-management/calendar', { params });
    return response.data;
  },

  // Approve request (Admin only)
  approveRequest: async (
    requestId: number, 
    adminNotes?: string, 
    proposedStartDate?: string, 
    proposedEndDate?: string
  ): Promise<{ message: string }> => {
    const response = await api.post(`/api/leave-management/approve/${requestId}`, {
      admin_notes: adminNotes,
      proposed_start_date: proposedStartDate,
      proposed_end_date: proposedEndDate
    });
    return response.data;
  },

  // Deny request (Admin only)
  denyRequest: async (requestId: number, adminNotes?: string): Promise<{ message: string }> => {
    const response = await api.post(`/api/leave-management/deny/${requestId}`, {
      admin_notes: adminNotes
    });
    return response.data;
  },

  // Propose vacation dates (Admin only)
  proposeVacationDates: async (
    requestId: number, 
    proposedStartDate: string, 
    proposedEndDate: string, 
    adminNotes?: string
  ): Promise<{ message: string }> => {
    const response = await api.post(`/api/leave-management/propose/${requestId}`, {
      proposed_start_date: proposedStartDate,
      proposed_end_date: proposedEndDate,
      admin_notes: adminNotes
    });
    return response.data;
  },

  // Get profiles with vacation days
  getProfiles: async (): Promise<Profile[]> => {
    const response = await api.get('/api/leave-management/profiles');
    return response.data;
  },

  // Get leave history for the past 12 months
  getLeaveHistory: async (): Promise<LeaveHistoryProfile[]> => {
    const response = await api.get('/api/leave-management/history');
    return response.data;
  },

  // Get vacation settings
  getVacationSettings: async (): Promise<VacationSettings> => {
    const response = await api.get('/api/leave-management/vacation-settings');
    return response.data;
  },

  // Update vacation reset date
  updateVacationSettings: async (resetDate: string): Promise<{ message: string }> => {
    const response = await api.put('/api/leave-management/vacation-settings', { reset_date: resetDate });
    return response.data;
  },

  // Update individual employee vacation days
  updateEmployeeVacationDays: async (profileId: number, totalDays: number): Promise<{ message: string }> => {
    const response = await api.put(`/api/leave-management/profiles/${profileId}/vacation-days`, { 
      total_vacation_days: totalDays 
    });
    return response.data;
  },

  // Reset vacation days for all employees
  resetAllVacationDays: async (): Promise<{ message: string }> => {
    const response = await api.post('/api/leave-management/reset-vacation-days');
    return response.data;
  },

  // Get leave statistics
  getLeaveStatistics: async (): Promise<LeaveStatistics> => {
    const response = await api.get('/api/leave-management/statistics');
    return response.data;
  }
};
