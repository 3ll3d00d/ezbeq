import { render, screen, userEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import WhatsNewSheet, { computeNewCount } from './WhatsNewSheet';
import type { CatalogueEntry } from '../../types/ezbeq';

const renderSheet = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

const entry = (overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 1,
  formattedTitle: 'Some Movie',
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
  freshness: 'Fresh',
  ...overrides,
});

describe('computeNewCount', () => {
  it('counts entries created or updated at/after lastChecked', () => {
    const entries = [entry({ created_at: 100 }), entry({ id: 2, updated_at: 200 }), entry({ id: 3, created_at: 50 })];
    expect(computeNewCount(entries, 100)).toBe(2);
  });

  it('returns 0 when nothing is new', () => {
    expect(computeNewCount([entry({ created_at: 10 })], 100)).toBe(0);
  });
});

describe('WhatsNewSheet', () => {
  it('renders nothing when not visible', async () => {
    await renderSheet(
      <WhatsNewSheet
        visible={false}
        onClose={jest.fn()}
        entries={[entry()]}
        lastChecked={0}
        initialMode="new"
        onSelect={jest.fn()}
      />
    );

    expect(screen.queryByText("What's New")).toBeNull();
  });

  it('shows the New tab entries by default when initialMode is new', async () => {
    const entries = [
      entry({ id: 1, formattedTitle: 'Fresh Movie', created_at: 200 }),
      entry({ id: 2, formattedTitle: 'Old Movie', created_at: 10 }),
    ];
    await renderSheet(
      <WhatsNewSheet visible entries={entries} lastChecked={100} initialMode="new" onClose={jest.fn()} onSelect={jest.fn()} />
    );

    expect(screen.getByText(/Fresh Movie/)).toBeTruthy();
    expect(screen.queryByText(/Old Movie/)).toBeNull();
  });

  it('switching to Recent shows every entry regardless of lastChecked', async () => {
    const entries = [
      entry({ id: 1, formattedTitle: 'Fresh Movie', created_at: 200 }),
      entry({ id: 2, formattedTitle: 'Old Movie', created_at: 10 }),
    ];
    const user = userEvent.setup();
    await renderSheet(
      <WhatsNewSheet visible entries={entries} lastChecked={100} initialMode="new" onClose={jest.fn()} onSelect={jest.fn()} />
    );

    await user.press(screen.getByText('Recent'));

    expect(screen.getByText(/Fresh Movie/)).toBeTruthy();
    expect(screen.getByText(/Old Movie/)).toBeTruthy();
  });

  it('shows the empty state text for the New tab when nothing qualifies', async () => {
    await renderSheet(
      <WhatsNewSheet
        visible
        entries={[entry({ created_at: 1 })]}
        lastChecked={1000}
        initialMode="new"
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByText('Nothing new since your last check.')).toBeTruthy();
  });

  it('tapping a row calls onSelect with its id', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await renderSheet(
      <WhatsNewSheet
        visible
        entries={[entry({ id: 42, created_at: 200 })]}
        lastChecked={100}
        initialMode="new"
        onClose={jest.fn()}
        onSelect={onSelect}
      />
    );

    await user.press(screen.getByTestId('whats-new-row-42'));

    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it('pressing close calls onClose', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    await renderSheet(
      <WhatsNewSheet visible entries={[]} lastChecked={0} initialMode="recent" onClose={onClose} onSelect={jest.fn()} />
    );

    await user.press(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows a freshness chip distinguishing New from Updated', async () => {
    const entries = [
      entry({ id: 1, formattedTitle: 'Fresh One', freshness: 'Fresh', created_at: 200 }),
      entry({ id: 2, formattedTitle: 'Updated One', freshness: 'Updated', created_at: 200 }),
    ];
    await renderSheet(
      <WhatsNewSheet visible entries={entries} lastChecked={100} initialMode="new" onClose={jest.fn()} onSelect={jest.fn()} />
    );

    expect(screen.getByTestId('freshness-chip-1')).toHaveTextContent('New');
    expect(screen.getByTestId('freshness-chip-2')).toHaveTextContent('Updated');
  });
});
