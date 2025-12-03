import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { attendanceAPI, timeTrackingAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  ShieldCheck,
  Satellite,
  RefreshCw,
} from 'lucide-react';

type Profile = { id: string; name: string };

type Geofence = {
  enabled: boolean;
  configured: boolean;
  center_latitude?: number | null;
  center_longitude?: number | null;
  radius_meters?: number | null;
};

type Shift = {
  id: string;
  profile_id?: string;
  clock_in: string;
  clock_out?: string | null;
};

const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const requestLocation = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    });
  });
};

export const AttendanceScreen: React.FC = () => {
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [distanceFromFence, setDistanceFromFence] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [hasFenceWarning, setHasFenceWarning] = useState(false);

  const normalizeGeofence = (data: any): Geofence => ({
    enabled: !!data?.enabled,
    configured:
      !!data?.configured &&
      data?.center_latitude !== null &&
      data?.center_longitude !== null &&
      data?.radius_meters !== null,
    center_latitude:
      data?.center_latitude !== undefined && data?.center_latitude !== null
        ? Number(data.center_latitude)
        : null,
    center_longitude:
      data?.center_longitude !== undefined && data?.center_longitude !== null
        ? Number(data.center_longitude)
        : null,
    radius_meters:
      data?.radius_meters !== undefined && data?.radius_meters !== null
        ? Number(data.radius_meters)
        : null,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [profileData, fenceData] = await Promise.all([
        timeTrackingAPI.getProfiles(),
        attendanceAPI.getGeofence(),
      ]);

      const normalizedProfiles = Array.isArray(profileData)
        ? profileData
        : Array.isArray(profileData?.profiles)
          ? profileData.profiles
          : [];
      setProfiles(normalizedProfiles);

      const resolvedProfile =
        selectedProfile ||
        normalizedProfiles?.[0]?.id?.toString() ||
        activeShift?.profile_id?.toString() ||
        '';

      if (resolvedProfile && !selectedProfile) {
        setSelectedProfile(resolvedProfile);
      }

      setGeofence(normalizeGeofence(fenceData));

      if (resolvedProfile) {
        const shift = await attendanceAPI.getActiveShift(resolvedProfile);
        setActiveShift(shift);
      } else {
        setActiveShift(null);
      }
    } catch (error: any) {
      console.error('Attendance bootstrap error', error);
      toast({
        title: 'Could not load attendance data',
        description: error?.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeShift?.profile_id, selectedProfile, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let watchId: number | null = null;
    if (!activeShift || !geofence?.configured) {
      setHasFenceWarning(false);
    }
    if (
      activeShift &&
      geofence?.configured &&
      geofence.center_latitude !== null &&
      geofence.center_longitude !== null
    ) {
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            const radius = geofence.radius_meters || 0;
            const distance = haversineMeters(
              latitude,
              longitude,
              geofence.center_latitude as number,
              geofence.center_longitude as number
            );
            setDistanceFromFence(Math.round(distance));

            if (distance > radius) {
              if (!hasFenceWarning) {
                if ('Notification' in window) {
                  if (Notification.permission === 'granted') {
                    new Notification('Clock out reminder', {
                      body: 'You left the geofence. Please remember to clock out.',
                    });
                  } else if (Notification.permission !== 'denied') {
                    Notification.requestPermission();
                  }
                }
                toast({
                  title: 'Left the geofence',
                  description: 'Looks like you moved outside the fence. Clock out when you are done.',
                });
                setHasFenceWarning(true);
              }
            } else if (hasFenceWarning) {
              setHasFenceWarning(false);
            }
          },
          (err) => setLocationError(err.message),
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
        );
      } catch (err: any) {
        setLocationError(err?.message || 'Unable to monitor location.');
      }
    }
      return (
    <div className="min-h-screen bg-gradient-background">
      <div className="p-4 space-y-6">
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
                onClick={() => loadData()}
                disabled={isLoading}
              >
                <RefreshCw className={`${isLoading ? 'animate-spin ' : ''}h-4 w-4`} />
              </Button>
            </div>

            {activeShift ? (
              <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="border-warning text-warning">
                    CLOCKED IN
                  </Badge>
                  <span className="text-sm text-muted-foreground">Started {formatTime(activeShift.clock_in)}</span>
                </div>
                <Button
                  onClick={handleClockOut}
                  disabled={isLoading}
                  variant="destructive"
                  size="mobile"
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Clocking out...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Clock out
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleClockIn}
                disabled={isLoading || !selectedProfile}
                variant="success"
                size="mobile"
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Checking location...
                  </>
                ) : (
                  <>
                    <Clock className="h-4 w-4 mr-2" />
                    Clock in for attendance
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center">
              <ShieldCheck className="h-5 w-5 mr-2 text-primary" />
              Geofence
            </CardTitle>
            <CardDescription>
              Clock-in is limited to the configured fence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {geofenceConfigured ? (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline" className="border-success text-success">
                    Enabled
                  </Badge>
                  <span className="text-muted-foreground">
                    {geofence?.center_latitude}, {geofence?.center_longitude} – Radius {geofence?.radius_meters} m
                  </span>
                </div>
                {distanceFromFence !== null && geofence?.radius_meters && (
                  <div className="flex items-center gap-2 text-sm">
                    <Satellite className="h-4 w-4 text-muted-foreground" />
                    <span className={withinFence ? 'text-success' : 'text-warning'}>
                      {withinFence ? 'Inside fence' : 'Outside fence'} ({distanceFromFence} m away)
                    </span>
                  </div>
                )}
                {locationError && (
                  <div className="flex items-center gap-2 text-sm text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    {locationError}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Geofence is not configured. Clock-ins will skip the location check.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AttendanceScreen;

