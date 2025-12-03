import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { timeTrackingAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { 
  Clock, 
  Play, 
  Square, 
  RefreshCw, 
  Timer,
  CheckCircle
} from 'lucide-react';

interface TimeEntry {
  id: string;
  profile_id: string;
  sales_order_id: string;
  clock_in: string;
  clock_out?: string;
  duration?: string | number;
  unit_price?: string | number;
  profile_name?: string;
  sales_order_number?: string;
  product_name?: string;
  status: 'active' | 'completed';
}

interface Profile {
  id: string;
  name: string;
}

interface SalesOrder {
  id: string;
  name: string;
  number: string;
  product_name?: string;
  customer_name?: string;
}

export const TimeTrackingScreen: React.FC = () => {
  const { toast } = useToast();
  
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [selectedSalesOrder, setSelectedSalesOrder] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentActiveEntry, setCurrentActiveEntry] = useState<TimeEntry | null>(null);

  // Use local date instead of UTC to match backend expectations
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    setIsLoading(true);
    
    try {
      console.log('=== FETCHING DATA ===');
      console.log('Date being fetched:', today);
      
      const [entriesData, profilesData, salesOrdersData] = await Promise.all([
        timeTrackingAPI.getTimeEntries(today),
        timeTrackingAPI.getProfiles(),
        timeTrackingAPI.getSalesOrders(),
      ]);

      const profileIdForActive =
        selectedProfile ||
        profilesData?.[0]?.id?.toString() ||
        currentActiveEntry?.profile_id?.toString();

      // Pull any still-open entries, regardless of date
      let activeEntriesData: any[] = [];
      try {
        activeEntriesData = await timeTrackingAPI.getActiveTimeEntries(profileIdForActive);
      } catch (err) {
        console.warn('Active entries endpoint unavailable, skipping', err);
      }
      
      console.log('=== RAW API RESPONSES ===');
      console.log('Entries API response:', entriesData);
      console.log('Profiles API response:', profilesData);
      console.log('Sales Orders API response:', salesOrdersData);
      console.log('Active entries API response:', activeEntriesData);
      
      // Handle different possible data structures and process entries
      let processedEntries = [];
      if (entriesData) {
        let rawEntries = [];
        if (Array.isArray(entriesData)) {
          rawEntries = entriesData;
          console.log('Entries data is an array with length:', rawEntries.length);
        } else if (entriesData.data && Array.isArray(entriesData.data)) {
          rawEntries = entriesData.data;
          console.log('Entries data is in .data property with length:', rawEntries.length);
        } else if (entriesData.timeEntries && Array.isArray(entriesData.timeEntries)) {
          rawEntries = entriesData.timeEntries;
          console.log('Entries data is in .timeEntries property with length:', rawEntries.length);
        } else {
          console.log('Entries data structure unknown:', typeof entriesData, entriesData);
        }
        
        // Process each entry to add status and ensure proper structure
        processedEntries = rawEntries.map((entry: any, index: number) => {
          console.log(`Processing entry ${index}:`, entry);
          return {
            id: entry.id?.toString(),
            profile_id: entry.profile_id?.toString(),
            sales_order_id: entry.sales_order_id?.toString(),
            clock_in: entry.clock_in,
            clock_out: entry.clock_out,
            duration: entry.duration,
            unit_price: entry.unit_price,
            profile_name: entry.profile_name,
            sales_order_number: entry.sales_order_number,
            product_name: entry.product_name,
            status: entry.clock_out ? 'completed' : 'active'
          };
        });
      } else {
        console.log('No entries data received');
      }
      
      console.log('=== PROCESSED DATA ===');
      console.log('Processed entries:', processedEntries);
      console.log('Profiles count:', profilesData?.length || 0);
      console.log('Sales orders count:', salesOrdersData?.length || 0);
      
      // Also try active entries (if endpoint exists)
      if (activeEntriesData && Array.isArray(activeEntriesData) && activeEntriesData.length > 0) {
        const activeEntries = activeEntriesData.map((entry: any) => ({
          id: entry.id?.toString(),
          profile_id: entry.profile_id?.toString(),
          sales_order_id: entry.sales_order_id?.toString(),
          clock_in: entry.clock_in,
          clock_out: entry.clock_out,
          duration: entry.duration,
          unit_price: entry.unit_price,
          profile_name: entry.profile_name,
          sales_order_number: entry.sales_order_number,
          product_name: entry.product_name,
          status: 'active'
        }));
        
        // Merge without duplicates
        const existingIds = new Set(processedEntries.map(e => e.id));
        const newActiveEntries = activeEntries.filter(entry => !existingIds.has(entry.id));
        processedEntries = [...processedEntries, ...newActiveEntries];
      }
      
      console.log('Processed entries:', processedEntries);
      
      // If we have a current active entry, make sure it's included in the processed entries
      if (currentActiveEntry) {
        const existingEntry = processedEntries.find(entry => entry.id === currentActiveEntry.id);
        if (!existingEntry) {
          processedEntries.push(currentActiveEntry);
        }
      }
      
      // Merge with existing entries to prevent losing local state
      setTimeEntries(prev => {
        // If we got data from backend, use it as base
        if (processedEntries.length > 0) {
          return processedEntries;
        }
        // If backend returned empty but we have existing entries, keep them
        return prev;
      });
      setProfiles(profilesData || []);
      setSalesOrders(salesOrdersData || []);

      // If we just learned about an active entry and don't have a profile selected yet, align selection to it
      if (!selectedProfile && profileIdForActive) {
        setSelectedProfile(profileIdForActive.toString());
      }
      
      // Clear selected profile if it's no longer available
      if (profilesData && profilesData.length === 0 && selectedProfile) {
        setSelectedProfile('');
        setSelectedSalesOrder('');
      }
      
      console.log('Profiles loaded:', profilesData);
      console.log('Selected profile after load:', selectedProfile);
    } catch (error: any) {
      console.error('Fetch error:', error);
      toast({
        title: "Failed to load data",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentActiveEntry, selectedProfile, today, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-select the first profile when profiles are loaded (only if user has profiles)
  useEffect(() => {
    const normalizedSelected = selectedProfile?.toString() || '';
    if (profiles.length > 0) {
      const hasSelected = normalizedSelected && profiles.some(p => p.id?.toString() === normalizedSelected);
      if (!hasSelected) {
        console.log('Auto-selecting profile:', profiles[0]);
        setSelectedProfile(profiles[0].id?.toString() || '');
      }
    }
  }, [profiles, selectedProfile]);

  const handleClockIn = async () => {
    if (!selectedProfile || !selectedSalesOrder) {
      toast({
        title: "Selection Required",
        description: "Please select both a profile and sales order",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await timeTrackingAPI.clockIn(selectedProfile, selectedSalesOrder);
      console.log('Clock in response:', response);
      
      toast({
        title: "Clocked In!",
        description: "Successfully started time tracking",
      });
      
      // Use the response directly to create a time entry
      if (response && response.id) {
        const newTimeEntry: TimeEntry = {
          id: response.id.toString(),
          profile_id: response.profile_id.toString(),
          sales_order_id: response.sales_order_id.toString(),
          clock_in: response.clock_in || new Date().toISOString(),
          profile_name: response.profile_name,
          sales_order_number: response.sales_order_number,
          product_name: response.product_name,
          status: 'active'
        };
        
        console.log('Created time entry from response:', newTimeEntry);
        setCurrentActiveEntry(newTimeEntry);
        // Don't overwrite existing entries, just add the new one
        setTimeEntries(prev => {
          // Remove any existing entry with the same ID to avoid duplicates
          const filtered = prev.filter(entry => entry.id !== newTimeEntry.id);
          return [...filtered, newTimeEntry];
        });
      }
      
      // Don't fetch data from backend immediately after clock-in
      // The currentActiveEntry state will handle the UI update
      
      // Don't clear the selections - keep them for reference
    } catch (error: any) {
      toast({
        title: "Clock In Failed",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async (entryId: string) => {
    setIsLoading(true);
    try {
      await timeTrackingAPI.clockOut(entryId);
      toast({
        title: "Clocked Out!",
        description: "Time entry completed successfully",
      });
      
      // Clear the current active entry
      setCurrentActiveEntry(null);
      
      // Update the time entries to mark this entry as completed
      setTimeEntries(prev => 
        prev.map(entry => 
          entry.id === entryId 
            ? { ...entry, clock_out: new Date().toISOString(), status: 'completed' as const }
            : entry
        )
      );
      
      // Fetch fresh data to get the updated entry with duration
      // Remove setTimeout to avoid stale closure issues
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Clock Out Failed",
        description: error.response?.data?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = (timeString: string) => {
    if (!timeString) return '-';
    return new Date(timeString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: userTimeZone,
    });
  };

  const getProfileName = (profileId: string) => {
    return profiles.find(p => p.id === profileId)?.name || 'Unknown Profile';
  };

  const displayOrderNumber = (orderNumber?: string) =>
    orderNumber ? orderNumber.replace(/^SO-?/i, '').trim() : 'Unknown Order';

  const formatSalesOrderLabel = (salesOrder?: SalesOrder) => {
    if (!salesOrder) return 'Unknown Order';
    const parts = [
      displayOrderNumber(salesOrder.number),
      salesOrder.customer_name,
      salesOrder.product_name || salesOrder.name
    ].filter(Boolean);

    return parts.join(' | ');
  };

  const getSalesOrderName = (salesOrderId: string) => {
    const so = salesOrders.find(s => s.id === salesOrderId);
    return formatSalesOrderLabel(so);
  };

  // Helper function to get profile name from time entry data
  const getProfileNameFromEntry = (entry: any) => {
    return entry.profile_name || getProfileName(entry.profile_id);
  };

  // Helper function to get sales order name from time entry data
  const getSalesOrderNameFromEntry = (entry: any) => {
    const labelFromState = getSalesOrderName(entry.sales_order_id);
    if (labelFromState !== 'Unknown Order') {
      return labelFromState;
    }

    const fallbackParts = [entry.sales_order_number, entry.customer_name, entry.product_name].filter(Boolean);
    return fallbackParts.join(' | ') || 'Unknown Order';
  };

  const activeEntries = timeEntries.filter(entry => entry.status === 'active');
  const completedEntries = timeEntries.filter(entry => entry.status === 'completed');

  // Find the active entry for the selected profile
  const activeEntryForProfile = timeEntries.find(
    entry => entry.profile_id === selectedProfile && entry.status === 'active'
  );

  // Find if there are any open entries for the current user's profile
  const allEntries = timeEntries;
  const hasActiveEntries = selectedProfile ? allEntries.some(entry => 
    entry.profile_id?.toString() === selectedProfile?.toString() && !entry.clock_out
  ) : false;
  const selectedSalesOrderDetails = selectedSalesOrder
    ? salesOrders.find(so => so.id?.toString() === selectedSalesOrder?.toString())
    : undefined;
  
  console.log('Current time entries:', timeEntries);
  console.log('Current active entry:', currentActiveEntry);
  console.log('All entries:', allEntries);
  console.log('Has active entries:', hasActiveEntries);
  console.log('Active entries:', allEntries.filter(entry => !entry.clock_out));
  


  return (
    <div className="min-h-screen bg-gradient-background">
      <div className="p-4 space-y-6">
        {/* Core selection focus */}
        <Card className="shadow-card border-0">
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Assigned profile</p>
                <p className="text-base font-semibold">
                  {profiles.length === 0
                    ? 'No profile assigned. You can view time entries but cannot clock in.'
                    : profiles.find(p => p.id?.toString() === selectedProfile?.toString())?.name || 'Loading...'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="space-y-3">
              <p className="text-lg font-semibold text-center">Select your sales order</p>
              <Select value={selectedSalesOrder} onValueChange={setSelectedSalesOrder} disabled={!selectedProfile}>
                <SelectTrigger className="h-auto min-h-[3.5rem] items-start py-3 px-4 text-left text-base border-2 border-primary bg-white/90 shadow-md">
                  <div className="flex flex-col text-left w-full">
                    {selectedSalesOrderDetails ? (
                      <>
                        <span className="font-semibold leading-tight">
                          {displayOrderNumber(selectedSalesOrderDetails.number)}
                        </span>
                        <span className="text-xs text-muted-foreground leading-tight">
                          {[selectedSalesOrderDetails.customer_name, selectedSalesOrderDetails.product_name].filter(Boolean).join(' | ') || 'No additional details'}
                        </span>
                      </>
                    ) : (
                      <span className="text-base font-semibold text-primary">
                        {selectedProfile ? "Select a sales order" : "No profile assigned"}
                      </span>
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-80 bg-white shadow-lg border min-w-[18rem]">
                  {salesOrders.map((so) => {
                    // Only disable SO if the selected profile has an open entry for this SO
                    const isClockedInForSO = !!(selectedProfile && allEntries.find(
                      entry => entry.profile_id?.toString() === selectedProfile?.toString() && entry.sales_order_id?.toString() === so.id?.toString() && !entry.clock_out
                    ));
                    const label = formatSalesOrderLabel(so);
                    const numberDisplay = displayOrderNumber(so.number);
                    return (
                      <SelectItem
                        key={so.id}
                        value={so.id}
                        textValue={label}
                        className="items-start gap-2 whitespace-normal py-3 px-4 text-left leading-5 hover:bg-primary/5"
                        disabled={isClockedInForSO}
                      >
                        <div className="flex flex-col gap-1 text-left w-full">
                          <div className="flex items-start gap-2">
                            <span className="font-semibold text-sm">{numberDisplay}</span>
                            {so.customer_name && (
                              <span className="text-xs text-muted-foreground truncate">
                                {so.customer_name}
                              </span>
                            )}
                          </div>
                          {so.product_name && (
                            <span className="text-xs text-muted-foreground leading-tight">{so.product_name}</span>
                          )}
                          {isClockedInForSO ? <span className="text-[11px] font-medium text-warning">Already Clocked In</span> : ''}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            {!hasActiveEntries ? (
              <>
                {!selectedProfile ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground text-sm">
                      No profile selected. You can view time entries but cannot clock in.
                    </p>
                  </div>
                ) : (
                  <Button
                    onClick={handleClockIn}
                    disabled={
                      isLoading ||
                      !selectedProfile ||
                      !selectedSalesOrder
                    }
                    variant="success"
                    size="mobile"
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                        Clocking In...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Clock In
                      </>
                    )}
                  </Button>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-warning text-sm font-medium">
                  You are currently clocked in. Please clock out before starting a new session.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

                 {/* Current Active Time Entry */}
         {allEntries.filter(entry => !entry.clock_out).map(entry => {
           const isOwnEntry = entry.profile_id?.toString() === selectedProfile?.toString();
           console.log('Profile comparison:', {
             entryProfileId: entry.profile_id,
             selectedProfile: selectedProfile,
             entryProfileIdType: typeof entry.profile_id,
             selectedProfileType: typeof selectedProfile,
             isOwnEntry: isOwnEntry
           });
           return (
             <Card key={entry.id} className="shadow-card border-0 bg-warning/5 border-warning/20">
               <CardHeader className="pb-3">
                 <div className="flex items-center justify-between">
                   <div className="flex items-center space-x-2">
                     <div className="w-3 h-3 bg-warning rounded-full animate-pulse" />
                     <Badge variant="outline" className="border-warning text-warning">
                       {isOwnEntry ? 'CURRENTLY CLOCKED IN' : 'CLOCKED IN'}
                     </Badge>
                   </div>
                   <span className="text-sm text-muted-foreground">
                     Started: {formatTime(entry.clock_in)}
                   </span>
                 </div>
               </CardHeader>
               <CardContent className="space-y-4">
                 <div className="space-y-2">
                   <div>
                     <p className="text-sm font-medium text-muted-foreground">Profile</p>
                     <p className="font-medium">{getProfileNameFromEntry(entry)}</p>
                   </div>
                                    <div>
                   <p className="text-sm font-medium text-muted-foreground">Sales Order</p>
                   <p className="text-sm">{getSalesOrderNameFromEntry(entry)}</p>
                   {entry.product_name && (
                     <p className="text-xs text-muted-foreground mt-1">{entry.product_name}</p>
                   )}
                 </div>
                 </div>
                 {isOwnEntry ? (
                   <Button
                     onClick={() => handleClockOut(entry.id)}
                     disabled={isLoading}
                     variant="destructive"
                     size="mobile"
                     className="w-full"
                   >
                     <Square className="h-4 w-4 mr-2" />
                     Clock Out
                   </Button>
                 ) : (
                   <div className="text-center py-2">
                     <p className="text-sm text-muted-foreground">
                       Only {getProfileNameFromEntry(entry)} can clock out of this session
                     </p>
                   </div>
                 )}
               </CardContent>
             </Card>
           );
         })}

        {/* Today's Completed Entries */}
        {completedEntries.length > 0 && (
          <Card className="shadow-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <CheckCircle className="h-5 w-5 mr-2 text-success" />
                Today's Completed
              </CardTitle>
              <CardDescription>Finished time entries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {completedEntries.map((entry) => (
                <div key={entry.id} className="border rounded-lg p-4 bg-success/5 border-success/20">
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="outline" className="border-success text-success">
                      COMPLETED
                    </Badge>
                    <span className="text-sm font-medium">
                      {entry.duration ? (typeof entry.duration === 'string' ? parseFloat(entry.duration).toFixed(2) : entry.duration.toFixed(2)) : '0.00'} hours
                    </span>
                  </div>
                  
                  <div className="space-y-1 mb-3">
                    <p className="font-medium">{getProfileNameFromEntry(entry)}</p>
                    <p className="text-sm text-muted-foreground">
                      {getSalesOrderNameFromEntry(entry)}
                    </p>
                    {entry.product_name && (
                      <p className="text-xs text-muted-foreground">
                        {entry.product_name}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>In: {formatTime(entry.clock_in)}</span>
                    {entry.clock_out && (
                      <span>Out: {formatTime(entry.clock_out)}</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {timeEntries.length === 0 && !isLoading && (
          <Card className="shadow-card border-0 text-center py-8">
            <CardContent>
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No time entries today</h3>
              <p className="text-muted-foreground mb-4">
                Clock in to start tracking your work time
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
