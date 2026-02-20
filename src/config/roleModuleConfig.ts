// Define which modules are accessible by each role
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
  ],
  purchaseManager: ['purchase', 'indent', 'vendorDept', 'vendorIssue'],
  warehouseManager: ['stock', 'psir', 'vsir', 'inHouseIssue'],
  itemMaster: ['itemMaster'],
  viewer: ['stock', 'psir', 'vsir'],
};

// Define module metadata
export const moduleMetadata: Record<
  string,
  { label: string; icon?: string; description: string }
> = {
  purchase: { label: 'Purchase', description: 'Manage purchase orders' },
  indent: { label: 'Indent', description: 'Manage indents' },
  vendorDept: { label: 'Vendor Dept', description: 'Vendor department management' },
  vendorIssue: { label: 'Vendor Issue', description: 'Vendor issues tracking' },
  inHouseIssue: {
    label: 'In-House Issue',
    description: 'Internal issue management',
  },
  psir: { label: 'PSIR', description: 'Purchase Stock Issue Report' },
  vsir: { label: 'VSIR', description: 'Vendor Stock Issue Report' },
  stock: { label: 'Stock', description: 'Inventory management' },
  itemMaster: { label: 'Item Master', description: 'Master item configuration' },
};
