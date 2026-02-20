# Role-Based Access Control Setup Guide

## Overview
The ACU ERP system now supports role-based access control (RBAC). Different users can be assigned different roles, and each role has access to specific modules.

## Available Roles

### 1. **Admin**
- **Access**: All modules
- **Modules**: Purchase, Indent, Vendor Dept, Vendor Issue, In-House Issue, PSIR, VSIR, Stock, Item Master
- **Description**: Full system access

### 2. **Purchase Manager**
- **Access**: Purchase-related modules
- **Modules**: Purchase, Indent, Vendor Dept, Vendor Issue
- **Description**: Manages purchase operations and vendor management

### 3. **Warehouse Manager**
- **Access**: Warehouse and stock-related modules
- **Modules**: Stock, PSIR, VSIR, In-House Issue
- **Description**: Manages inventory and warehouse operations

### 4. **Item Master**
- **Access**: Item configuration only
- **Modules**: Item Master
- **Description**: Manages item master data

### 5. **Viewer**
- **Access**: Read-only access to inventory
- **Modules**: Stock, PSIR, VSIR
- **Description**: View-only access to reports

## Setting Up User Roles in Firestore

### Step 1: Add User Document to Firestore
Navigate to your Firestore console and create a collection called `users` if it doesn't exist.

### Step 2: Add User Records
For each user, create a document with the user's UID as the document ID. Structure:

```json
{
  "email": "user@example.com",
  "role": "purchaseManager",
  "displayName": "John Doe",
  "permissions": [],
  "createdAt": "2024-01-18T10:00:00Z"
}
```

### Create a seeded admin from the repo
You can create (or update) an admin user and initialize their `userData` doc using the included script (requires a Firebase service account JSON):

```
node scripts/create-admin-user.js --uid 4OzW9GTwokTOnza0A0e4DNclJ6H2 --email admin@example.com --role admin --serviceAccount ./serviceAccount.json
```

This will create/overwrite `users/{uid}` with the provided role, and initialize an empty `userData/{uid}` if missing.

### Step 3: Assign Roles
Set the `role` field to one of the available roles:
- `admin`
- `purchaseManager`
- `warehouseManager`
- `itemMaster`
- `viewer`

## Example User Configurations

### Admin User
```json
{
  "email": "admin@acuerp.com",
  "role": "admin",
  "displayName": "Admin User",
  "permissions": [],
  "createdAt": "2024-01-18"
}
```

### Purchase Manager
```json
{
  "email": "purchase@acuerp.com",
  "role": "purchaseManager",
  "displayName": "Purchase Manager",
  "permissions": ["create_po", "approve_po"],
  "createdAt": "2024-01-18"
}
```

### Warehouse Manager
```json
{
  "email": "warehouse@acuerp.com",
  "role": "warehouseManager",
  "displayName": "Warehouse Manager",
  "permissions": ["manage_stock", "view_reports"],
  "createdAt": "2024-01-18"
}
```

## How It Works

1. **Login**: User logs in with email and password
2. **Role Fetch**: The system fetches the user's role from Firestore
3. **Access Control**: Based on the role, only allowed modules are displayed in the navigation
4. **Module Visibility**: Users cannot access modules they don't have permission for
5. **Default Behavior**: If a user document doesn't exist, they're assigned the `viewer` role by default

## Customization

### Adding New Modules to a Role
Edit `src/config/roleModuleConfig.ts`:

```typescript
export const roleModuleAccess: Record<string, string[]> = {
  admin: [
    'purchase',
    'indent',
    'vendorDept',
    'vendorIssue',
    'inHouseIssue',
    'psir',
    'vsir',
    'stock',
    'itemMaster',
    'newModule', // Add new module
  ],
  // ... other roles
};
```

### Creating a New Role
1. Add the role and its module access in `src/config/roleModuleConfig.ts`
2. Create user documents in Firestore with the new role

### Checking Permissions in Components
Use the `useAccessControl` hook:

```typescript
import { useAccessControl } from './hooks/useAccessControl';
import { useUserRole } from './hooks/useUserRole';

function MyComponent({ user }) {
  const { userProfile } = useUserRole(user);
  const accessControl = useAccessControl(userProfile);

  if (!accessControl.hasAccessToModule('purchase')) {
    return <div>Access Denied</div>;
  }

  // Your component content
}
```

## Files Modified/Created

- **New**: `src/config/roleModuleConfig.ts` - Role and module definitions
- **New**: `src/hooks/useUserRole.ts` - Hook to fetch user role from Firestore
- **New**: `src/hooks/useAccessControl.ts` - Hook for access control logic
- **Modified**: `src/App.tsx` - Integrated role-based navigation and module loading
