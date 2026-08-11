import { act, render, screen, userEvent } from '@testing-library/react-native';

import CatalogueList from './CatalogueList';
import type { CatalogueEntry } from '../../types/ezbeq';

// ScrollView is entirely stubbed out under the RN jest preset, so the RefreshControl element it's
// handed never actually mounts as a queryable host node (see `props.refreshControl` on the
// stubbed-out RCTScrollView JSON below) - fireEvent(getByTestId(...), 'refresh') has nothing to
// find. Walking the toJSON() tree for the raw (unrendered but very much real) element and
// invoking its onRefresh prop directly is the only way to exercise the wiring under test.
const findRefreshControlElement = (node: any): any => {
  if (!node) return null;
  if (node.props?.refreshControl) return node.props.refreshControl;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findRefreshControlElement(child);
      if (found) return found;
    }
  }
  return null;
};

const entry = (id: number, title: string): CatalogueEntry => ({
  id,
  formattedTitle: title,
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
});

test('shows an empty state when there are no entries', async () => {
  await render(<CatalogueList entries={[]} selectedEntryId={null} onSelectEntry={jest.fn()} />);

  expect(screen.getByText('No results')).toBeTruthy();
});

test('renders a row per entry', async () => {
  const entries = [entry(1, 'Movie One'), entry(2, 'Movie Two')];

  await render(<CatalogueList entries={entries} selectedEntryId={null} onSelectEntry={jest.fn()} />);

  expect(screen.getByText('Movie One')).toBeTruthy();
  expect(screen.getByText('Movie Two')).toBeTruthy();
});

test('tapping a row calls onSelectEntry with its id', async () => {
  const onSelectEntry = jest.fn();
  const user = userEvent.setup();
  const entries = [entry(1, 'Movie One'), entry(2, 'Movie Two')];
  await render(<CatalogueList entries={entries} selectedEntryId={null} onSelectEntry={onSelectEntry} />);

  await user.press(screen.getByText('Movie Two'));

  expect(onSelectEntry).toHaveBeenCalledWith(2);
});

test('pulling to refresh calls onRefresh', async () => {
  const onRefresh = jest.fn();
  const entries = [entry(1, 'Movie One')];
  await render(
    <CatalogueList
      entries={entries}
      selectedEntryId={null}
      onSelectEntry={jest.fn()}
      refreshing={false}
      onRefresh={onRefresh}
    />
  );
  // Flushes FlashList's own pending onLoad timeout so it doesn't fire (and warn about an
  // unwrapped act()) after this test has already finished.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  findRefreshControlElement(screen.toJSON()).props.onRefresh();

  expect(onRefresh).toHaveBeenCalled();
});

test('pulling to refresh on the empty state also calls onRefresh', async () => {
  const onRefresh = jest.fn();
  await render(
    <CatalogueList entries={[]} selectedEntryId={null} onSelectEntry={jest.fn()} refreshing={false} onRefresh={onRefresh} />
  );

  findRefreshControlElement(screen.toJSON()).props.onRefresh();

  expect(onRefresh).toHaveBeenCalled();
});

test('does not offer pull-to-refresh when onRefresh is not provided', async () => {
  await render(<CatalogueList entries={[]} selectedEntryId={null} onSelectEntry={jest.fn()} />);

  expect(findRefreshControlElement(screen.toJSON())).toBeNull();
});
