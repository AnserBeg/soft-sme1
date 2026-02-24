import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { attendanceAPI, timeTrackingAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarDays, Clock, Loader2, RefreshCw } from 'lucide-react';

type Profile = {
  id: string | number;
  name: string;
};

type Shift = {
  id: string | number;
  profile_id?: string | number;
  profile_name?: string;
  clock_in: string;
  clock_out?: string | null;
  duration?: string | number | null;
};

type TimeEntry = {
  id: string | number;
  profile_id?: string | number;
  sales_order_id?: string | number;
  sales_order_number?: string;
  clock_in: string;
  clock_out?: string | null;
  duration?: string | number | null;
};

const toLocalDateString = (date: Date) => date.toLocaleDateString('en-CA');

const parseDateInput = (value: string) => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day);
};

const toStartOfDayISO = (value: string) => {
  const date = parseDateInput(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
};

const toEndOfDayISO = (value: string) => {
  const date = parseDateInput(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString();
};

const parseDurationHours = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    const hhmmssMatch = trimmed.match(/^(-?)(\d+):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (hhmmssMatch) {
      const sign = hhmmssMatch[1] === '-' ? -1 : 1;
      const hours = parseInt(hhmmssMatch[2], 10);
      const minutes = parseInt(hhmmssMatch[3], 10);
      const seconds = hhmmssMatch[4] ? parseInt(hhmmssMatch[4], 10) : 0;
      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        return null;
      }
      return sign * (hours + minutes / 60 + seconds / 3600);
    }
  }
  return null;
};

const formatTime = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
};

const resolveShiftHours = (shift: Shift) => {
  const parsed = parseDurationHours(shift.duration);
  if (parsed !== null && !Number.isNaN(parsed)) {
    return parsed;
  }
  const start = new Date(shift.clock_in).getTime();
  if (Number.isNaN(start)) return 0;
  const end = shift.clock_out ? new Date(shift.clock_out).getTime() : Date.now();
  return Math.max(0, (end - start) / (1000 * 60 * 60));
};

const resolveEntryHours = (entry: TimeEntry) => {
  const parsed = parseDurationHours(entry.duration);
  if (parsed !== null && !Number.isNaN(parsed)) {
    return parsed;
  }
  const start = new Date(entry.clock_in).getTime();
  if (Number.isNaN(start)) return 0;
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  return Math.max(0, (end - start) / (1000 * 60 * 60));
};

const getSalesOrderLabel = (entry: TimeEntry) => {
  if (entry.sales_order_number) return entry.sales_order_number;
  if (entry.sales_order_id) return `SO-${entry.sales_order_id}`;
  return 'Unknown Order';
};

export const WorkSummaryScreen: React.FC = () => {
  const { toast } = useToast();
  const today = new Date();
  const defaultTo = toLocalDateString(today);
  const defaultFrom = toLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [shiftEntries, setShiftEntries] = useState<Record<string, TimeEntry[]>>({});
  const [unscheduledEntries, setUnscheduledEntries] = useState<TimeEntry[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedProfile = profiles.find((profile) => profile.id?.toString() === profileId?.toString());
  const selectedShift = shifts.find((shift) => shift.id?.toString() === selectedShiftId?.toString());
  const selectedShiftEntries = selectedShiftId ? shiftEntries[selectedShiftId] || [] : [];

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const profileData = await timeTrackingAPI.getProfiles();
      const normalizedProfiles = Array.isArray(profileData)
        ? profileData
        : Array.isArray(profileData?.profiles)
          ? profileData.profiles
          : [];
      setProfiles(normalizedProfiles);

      const resolvedProfileId =
        profileId ||
        normalizedProfiles?.[0]?.id?.toString() ||
        '';
      if (resolvedProfileId && !profileId) {
        setProfileId(resolvedProfileId);
      }
    } catch (error: any) {
      toast({
        title: 'Failed to load profiles',
        description: error?.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [profileId, toast]);

  const loadReport = useCallback(
    async (showRefresh = false) => {
      if (!profileId) return;
      if (!fromDate || !toDate) {
        toast({
          title: 'Select a date range',
          description: 'Please choose both start and end dates.',
          variant: 'destructive',
        });
        return;
      }
      if (fromDate > toDate) {
        toast({
          title: 'Invalid date range',
          description: 'The start date must be on or before the end date.',
          variant: 'destructive',
        });
        return;
      }

      if (showRefresh) setIsRefreshing(true);
      setIsLoading(true);

      try {
        const [entriesData, shiftsData] = await Promise.all([
          timeTrackingAPI.getTimeEntryReport(fromDate, toDate, profileId),
          attendanceAPI.getShifts({
            from: toStartOfDayISO(fromDate),
            to: toEndOfDayISO(toDate),
            profile_id: profileId,
          }),
        ]);

        const normalizedEntries = Array.isArray(entriesData)
          ? entriesData
          : Array.isArray(entriesData?.data)
            ? entriesData.data
            : [];
        const normalizedShifts = Array.isArray(shiftsData)
          ? shiftsData
          : Array.isArray(shiftsData?.data)
            ? shiftsData.data
            : [];

        const shiftEntryMap: Record<string, TimeEntry[]> = {};
        const unscheduled: TimeEntry[] = [];
        const nowMs = Date.now();

        normalizedShifts.forEach((shift: Shift) => {
          shiftEntryMap[shift.id?.toString()] = [];
        });

        normalizedEntries.forEach((entry: TimeEntry) => {
          const entryIn = new Date(entry.clock_in).getTime();
          if (Number.isNaN(entryIn)) {
            unscheduled.push(entry);
            return;
          }
          let found = false;
          for (const shift of normalizedShifts) {
            const shiftId = shift.id?.toString();
            if (!shiftId) continue;
            const shiftIn = new Date(shift.clock_in).getTime();
            if (Number.isNaN(shiftIn)) continue;
            const shiftOut = shift.clock_out ? new Date(shift.clock_out).getTime() : nowMs;
            const sameProfile =
              !shift.profile_id ||
              !entry.profile_id ||
              shift.profile_id?.toString() === entry.profile_id?.toString();
            if (sameProfile && entryIn >= shiftIn && entryIn < shiftOut) {
              shiftEntryMap[shiftId].push(entry);
              found = true;
              break;
            }
          }
          if (!found) {
            unscheduled.push(entry);
          }
        });

        Object.values(shiftEntryMap).forEach((list) => {
          list.sort((a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime());
        });

        setEntries(normalizedEntries);
        setShifts(normalizedShifts);
        setShiftEntries(shiftEntryMap);
        setUnscheduledEntries(unscheduled);
      } catch (error: any) {
        console.error('Failed to load work summary', error);
        toast({
          title: 'Could not load work summary',
          description: error?.response?.data?.message || 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fromDate, profileId, toDate, toast]
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profileId) {
      loadReport();
    }
  }, [loadReport, profileId]);

  const totalShiftHours = useMemo(
    () => shifts.reduce((sum, shift) => sum + resolveShiftHours(shift), 0),
    [shifts]
  );
  const totalEntryHours = useMemo(
    () => entries.reduce((sum, entry) => sum + resolveEntryHours(entry), 0),
    [entries]
  );

  const sortedShifts = useMemo(() => {
    return [...shifts].sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime());
  }, [shifts]);

  return (
    <div className="min-h-screen bg-gradient-background">
      <div className="p-4 space-y-6">
        <Card className="shadow-card border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Work Summary
            </CardTitle>
            <CardDescription>View your hours and sales orders by shift.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Assigned profile</p>
                <p className="text-base font-semibold">
                  {profiles.length === 0
                    ? 'No profile assigned.'
                    : selectedProfile?.name || 'Loading...'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadReport(true)}
                disabled={isRefreshing || !profileId}
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fromDate">From</Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="toDate">To</Label>
                <Input
                  id="toDate"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </div>
            </div>

            <Button
              onClick={() => loadReport()}
              disabled={isLoading || !profileId}
              variant="success"
              size="mobile"
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Update summary'
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card border-0">
          <CardContent className="grid grid-cols-2 gap-4 text-center">
            <div className="rounded-lg border border-primary/10 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">Hours worked</p>
              <p className="text-2xl font-semibold">{totalShiftHours.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-success/10 bg-success/5 p-3">
              <p className="text-xs text-muted-foreground">Sales-order hours</p>
              <p className="text-2xl font-semibold">{totalEntryHours.toFixed(2)}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-muted/20 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Total shifts</p>
              <p className="text-xl font-semibold">{shifts.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Shifts
            </CardTitle>
            <CardDescription>Tap a shift to see sales orders.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && shifts.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : sortedShifts.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                No shifts found for this range.
              </div>
            ) : (
              sortedShifts.map((shift) => {
                const shiftId = shift.id?.toString();
                const relatedEntries = shiftId ? shiftEntries[shiftId] || [] : [];
                const bookedHours = relatedEntries.reduce((sum, entry) => sum + resolveEntryHours(entry), 0);
                const uniqueOrders = new Set(relatedEntries.map((entry) => getSalesOrderLabel(entry))).size;
                const isActive = !shift.clock_out;
                return (
                  <button
                    key={shiftId}
                    type="button"
                    onClick={() => setSelectedShiftId(shiftId)}
                    className="w-full text-left"
                  >
                    <div className="rounded-lg border border-border bg-background p-4 shadow-sm transition hover:bg-muted/30">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold">{formatDate(shift.clock_in)}</p>
                          <p className="text-xs text-muted-foreground">
                            In: {formatTime(shift.clock_in)} | Out: {formatTime(shift.clock_out)}
                          </p>
                        </div>
                        <Badge variant="outline" className={isActive ? 'border-warning text-warning' : ''}>
                          {isActive ? 'ACTIVE' : `${resolveShiftHours(shift).toFixed(2)} hrs`}
                        </Badge>
                      </div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {uniqueOrders > 0 ? (
                          <span>{uniqueOrders} sales order{uniqueOrders === 1 ? '' : 's'} | {bookedHours.toFixed(2)} hrs</span>
                        ) : (
                          <span>No sales orders recorded</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {unscheduledEntries.length > 0 && (
          <Card className="shadow-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Unscheduled entries</CardTitle>
              <CardDescription>Sales order entries not matched to a shift.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {unscheduledEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-muted/30 bg-muted/20 px-3 py-2 text-sm">
                  <p className="font-medium">{getSalesOrderLabel(entry)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(entry.clock_in)} | {resolveEntryHours(entry).toFixed(2)} hrs
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Dialog open={!!selectedShiftId} onOpenChange={(open) => { if (!open) setSelectedShiftId(null); }}>
          <DialogContent className="max-w-lg w-full max-h-[85vh] overflow-y-auto bg-background">
            <DialogHeader>
              <DialogTitle>Shift details</DialogTitle>
              <DialogDescription>
                {selectedShift
                  ? `${formatDate(selectedShift.clock_in)} | ${formatTime(selectedShift.clock_in)} - ${formatTime(selectedShift.clock_out)}`
                  : 'Shift summary'}
              </DialogDescription>
            </DialogHeader>
            {selectedShift ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">
                    {selectedShift.profile_name || selectedProfile?.name || 'Assigned profile'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Total shift: {resolveShiftHours(selectedShift).toFixed(2)} hrs
                  </p>
                </div>

                {selectedShiftEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales order entries for this shift.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedShiftEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{getSalesOrderLabel(entry)}</p>
                          <Badge variant="outline">
                            {resolveEntryHours(entry).toFixed(2)} hrs
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          In: {formatTime(entry.clock_in)} | Out: {formatTime(entry.clock_out)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default WorkSummaryScreen;
