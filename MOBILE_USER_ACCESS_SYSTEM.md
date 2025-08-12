# Mobile User Access Control System

## Overview

This system allows administrators to control which time tracking profiles mobile users can access. Mobile users with the "Mobile Time Tracker" role can only see and use profiles that have been explicitly granted to them by an administrator.

## Features

- **Role-based Access Control**: Only users with "Mobile Time Tracker" role can be granted profile access
- **Admin Management**: Administrators can grant and revoke profile access through a dedicated interface
- **Audit Trail**: All access grants and revokes are tracked with timestamps and admin information
- **Secure API**: Backend endpoints are protected with proper authentication and authorization
- **Mobile App Integration**: Mobile app automatically filters profiles based on user access

## Database Schema

### user_profile_access Table

```sql
CREATE TABLE user_profile_access (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, profile_id)
);
```

## API Endpoints

### For Mobile Users
- `GET /api/time-tracking/profiles` - Returns only profiles the user has access to
- `GET /api/time-tracking/time-entries` - Time entries filtered by user's accessible profiles
- `POST /api/time-tracking/time-entries/clock-in` - Clock in with accessible profiles only
- `POST /api/time-tracking/time-entries/:id/clock-out` - Clock out existing entries

### For Administrators
- `GET /api/time-tracking/admin/user-profile-access` - List all access assignments
- `POST /api/time-tracking/admin/user-profile-access` - Grant profile access to a user
- `DELETE /api/time-tracking/admin/user-profile-access/:id` - Revoke profile access
- `GET /api/time-tracking/admin/available-users` - List users eligible for profile access

## Setup Instructions

### 1. Run the Database Migration

```bash
cd soft-sme-backend
node run-user-profile-access-migration.js
```

### 2. Create Mobile Users

1. Go to the main application
2. Navigate to Employee Management
3. Create new users with the role "Mobile Time Tracker"

### 3. Grant Profile Access

1. Navigate to "Mobile User Access" in the Settings menu
2. Click "Grant Access"
3. Select a mobile user and a profile
4. Click "Grant Access"

## User Roles

### Mobile Time Tracker
- Can only access profiles granted by administrators
- Can clock in/out for assigned profiles only
- Sees filtered profile list in mobile app

### Admin
- Can manage all user profile access
- Can grant and revoke access
- Can view audit trail of access changes
- Has access to all profiles

### Time Tracking
- Can access all profiles (legacy role)
- Full access to time tracking features

## Mobile App Behavior

### When No Profiles Are Available
- Shows message: "No profiles available. Please contact your administrator to grant profile access."
- Clock in button is disabled
- User cannot proceed with time tracking

### When Profiles Are Available
- Shows only granted profiles in dropdown
- Normal time tracking functionality
- Clock in/out works as expected

## Security Features

1. **Role Validation**: Only "Mobile Time Tracker" users can be granted profile access
2. **Admin Only**: Only users with "Admin" role can manage access
3. **Soft Delete**: Access is revoked by setting `is_active = false` (preserves audit trail)
4. **Unique Constraints**: Prevents duplicate access grants
5. **Cascade Deletes**: Access is automatically removed when users or profiles are deleted

## Troubleshooting

### Mobile User Can't See Any Profiles
1. Check if the user has "Mobile Time Tracker" role
2. Verify that profile access has been granted by an admin
3. Check if the access is still active (`is_active = true`)

### Admin Can't Grant Access
1. Ensure the user has "Admin" role
2. Verify the target user has "Mobile Time Tracker" role
3. Check that the profile exists

### Migration Errors
1. Ensure PostgreSQL is running
2. Check database connection settings
3. Verify the migration file exists in `migrations/create_user_profile_access.sql`

## Future Enhancements

- Bulk access management
- Time-based access (expiry dates)
- Profile access groups
- Advanced audit reporting
- Email notifications for access changes 