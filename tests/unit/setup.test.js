describe('Test infrastructure', () => {
  it('vitest is configured correctly', () => {
    expect(true).toBe(true);
  });

  it('fast-check is available', async () => {
    const fc = await import('fast-check');
    expect(fc).toBeDefined();
    expect(typeof fc.assert).toBe('function');
  });
});
