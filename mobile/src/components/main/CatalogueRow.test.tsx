import { render, screen, userEvent } from '@testing-library/react-native';

import CatalogueRow from './CatalogueRow';
import type { CatalogueEntry } from '../../types/ezbeq';

const entry = (overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 1,
  formattedTitle: 'Some Movie (2020)',
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
  ...overrides,
});

test('renders the title, author initial, and audio type chip', async () => {
  await render(<CatalogueRow entry={entry()} selected={false} onPress={jest.fn()} />);

  expect(screen.getByText('Some Movie (2020)')).toBeTruthy();
  expect(screen.getByText('M')).toBeTruthy(); // avatar initial from "mkane"
  expect(screen.getByText('Atmos')).toBeTruthy();
});

test('renders an edition chip when present', async () => {
  await render(<CatalogueRow entry={entry({ edition: "Director's Cut" })} selected={false} onPress={jest.fn()} />);

  expect(screen.getByText("Director's Cut")).toBeTruthy();
});

test('calls onPress with the entry id when tapped', async () => {
  const onPress = jest.fn();
  const user = userEvent.setup();
  await render(<CatalogueRow entry={entry({ id: 42 })} selected={false} onPress={onPress} />);

  await user.press(screen.getByText('Some Movie (2020)'));

  expect(onPress).toHaveBeenCalledWith(42);
});

test('marks itself selected via accessibility state', async () => {
  await render(<CatalogueRow entry={entry({ id: 7 })} selected={true} onPress={jest.fn()} />);

  expect(screen.getByTestId('catalogue-row-7').props.accessibilityState).toEqual({ selected: true });
});
