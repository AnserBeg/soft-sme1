import { composeFinalMessage, ToolResultEnvelope } from './answerComposer';

describe('composeFinalMessage', () => {
  const baseCapabilities = {
    canCreateVendor: false,
    canCreateCustomer: false,
    canCreatePart: false,
  };

  it('renders a concise success summary with table preview for a single vendor', () => {
    const envelope: ToolResultEnvelope = {
      type: 'success',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Parts for Truck Inc' },
      rows: [
        {
          vendor_id: 42,
          vendor_name: 'Parts for Truck Inc',
          contact_person: 'Mira Patel',
          telephone_number: '555-0100',
          email: 'sales@parts.com',
        },
      ],
      total_rows: 1,
      attempts: { exact: true, fuzzy: false, schema_refreshed: false },
    };

    const result = composeFinalMessage({
      userText: 'Find vendor Parts for Truck Inc',
      tool: 'inventoryLookup',
      resultEnvelope: envelope,
      capabilities: baseCapabilities,
    });

    expect(result.text).toContain("Vendor 'Parts for Truck Inc' found (1 record).");
    expect(result.text).toContain('Next steps:');
    expect(result.uiHints).toBeDefined();
    expect((result.uiHints as any).table).toBeDefined();
    expect((result.uiHints as any).disambiguation).toBeUndefined();
    expect(result.severity).toBe('info');
  });

  it('lists disambiguation options with numbering and instruction', () => {
    const envelope: ToolResultEnvelope = {
      type: 'disambiguation',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Parts' },
      candidates: [
        { id: 42, display_name: 'Parts for Truck Inc', city: 'Calgary' },
        { id: 77, display_name: 'Parts 4 Trucks Incorporated', city: 'Edmonton' },
        { id: 88, display_name: 'Partsource', city: 'Red Deer' },
      ],
      attempts: { exact: true, fuzzy: true, schema_refreshed: false },
    };

    const result = composeFinalMessage({
      userText: 'Find parts vendor',
      tool: 'inventoryLookup',
      resultEnvelope: envelope,
      capabilities: baseCapabilities,
    });

    expect(result.text).toContain('Did you mean one of these vendors?');
    expect(result.text).toContain('1) Parts for Truck Inc');
    expect(result.text).toContain('Reply with the number or the exact name.');
    expect((result.uiHints as any).disambiguation).toHaveLength(3);
    expect(result.severity).toBe('info');
  });

  it('describes empty results with attempts and UI guidance when creation is unavailable', () => {
    const envelope: ToolResultEnvelope = {
      type: 'empty',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Acme Parts' },
      attempts: { exact: true, fuzzy: true, schema_refreshed: true },
    };

    const result = composeFinalMessage({
      userText: 'Look up vendor Acme Parts',
      tool: 'inventoryLookup',
      resultEnvelope: envelope,
      capabilities: baseCapabilities,
    });

    expect(result.text).toContain("No vendor named 'Acme Parts' was found.");
    expect(result.text).toContain('What I tried:');
    expect(result.text).toContain('Tried exact match.');
    expect(result.text).toContain('Also tried a partial (fuzzy) match.');
    expect(result.text).toContain('Refreshed schema and retried.');
    expect(result.text).toContain('You may need to add this vendor via the UI: Vendors → Add New.');
    expect(result.severity).toBe('warning');
    expect((result.uiHints as any).nextSteps).toContain('You may need to add this vendor via the UI: Vendors → Add New.');
  });

  it('suggests using a longer name when fuzzy match was not attempted', () => {
    const envelope: ToolResultEnvelope = {
      type: 'empty',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Pa' },
      attempts: { exact: true, fuzzy: false, schema_refreshed: false },
    };

    const result = composeFinalMessage({
      userText: 'Find vendor Pa',
      tool: 'inventoryLookup',
      resultEnvelope: envelope,
      capabilities: { ...baseCapabilities, canCreateVendor: true },
    });

    expect(result.text).toContain('Try a longer name or a more unique part of the name.');
    expect(result.text).toContain("I can create a new vendor 'Pa'—say 'Add vendor Pa'.");
    expect((result.uiHints as any).nextSteps).toEqual(
      expect.arrayContaining([
        'Try a longer name or a more unique part of the name.',
        "I can create a new vendor 'Pa'—say 'Add vendor Pa'.",
      ])
    );
  });

  it('categorizes errors for permission and DDL issues', () => {
    const permissionEnvelope: ToolResultEnvelope = {
      type: 'error',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Parts' },
      attempts: { exact: true, fuzzy: false, schema_refreshed: false },
      error: { code: 'PERMISSION_DENIED', message: 'not allowed' },
    };

    const ddlEnvelope: ToolResultEnvelope = {
      type: 'error',
      source: 'database',
      query: { entity_type: 'vendor', entity_name: 'Parts' },
      attempts: { exact: true, fuzzy: true, schema_refreshed: true },
      error: { code: 'SCHEMA_REFRESH_FAILED', message: 'ddl mismatch' },
    };

    const permissionResult = composeFinalMessage({
      userText: 'Find vendor',
      tool: 'inventoryLookup',
      resultEnvelope: permissionEnvelope,
      capabilities: baseCapabilities,
    });
    const ddlResult = composeFinalMessage({
      userText: 'Find vendor',
      tool: 'inventoryLookup',
      resultEnvelope: ddlEnvelope,
      capabilities: baseCapabilities,
    });

    expect(permissionResult.text).toContain("I don't have permission to view this data.");
    expect(permissionResult.severity).toBe('error');
    expect(ddlResult.text).toContain("The data source changed and I couldn't recover after a refresh.");
    expect(ddlResult.severity).toBe('error');
  });
});
