import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import MultiSelectField from './MultiSelectField';

// The field's option picker renders through react-native-paper's <Portal>, which needs a
// <Portal.Host> ancestor - normally supplied by <PaperProvider> at the app root (App.tsx).
const renderField = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

test('shows "Any" when nothing is selected', async () => {
  await renderField(
    <MultiSelectField label="Author" items={['a', 'b']} selectedValues={[]} onChange={jest.fn()} />
  );

  expect(screen.getByText('Any')).toBeTruthy();
});

test('shows a chip per selected value instead of the placeholder', async () => {
  await renderField(
    <MultiSelectField label="Author" items={['a', 'b']} selectedValues={['a']} onChange={jest.fn()} />
  );

  expect(screen.queryByText('Any')).toBeNull();
  expect(screen.getByText('a')).toBeTruthy();
});

test('opening the field shows a search box and all items', async () => {
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={[]} onChange={jest.fn()} />
  );

  await user.press(screen.getByText('Author'));

  expect(screen.getByPlaceholderText('Search Author')).toBeTruthy();
  expect(screen.getByTestId('option-alice')).toBeTruthy();
  expect(screen.getByTestId('option-bob')).toBeTruthy();
});

test('tapping an unselected item adds it', async () => {
  const onChange = jest.fn();
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={['bob']} onChange={onChange} />
  );

  await user.press(screen.getByText('Author'));
  await user.press(screen.getByTestId('option-alice'));

  expect(onChange).toHaveBeenCalledWith(['bob', 'alice']);
});

test('tapping an already-selected item removes it', async () => {
  const onChange = jest.fn();
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={['alice', 'bob']} onChange={onChange} />
  );

  await user.press(screen.getByText('Author'));
  await user.press(screen.getByTestId('option-alice'));

  expect(onChange).toHaveBeenCalledWith(['bob']);
});

test('typing in the search box narrows the visible options', async () => {
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={[]} onChange={jest.fn()} />
  );
  await user.press(screen.getByText('Author'));

  await user.type(screen.getByPlaceholderText('Search Author'), 'ali');

  expect(screen.getByTestId('option-alice')).toBeTruthy();
  expect(screen.queryByTestId('option-bob')).toBeNull();
});

test('an out-of-view option renders struck through', async () => {
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField
      label="Year"
      items={['2020', '2021']}
      selectedValues={[]}
      onChange={jest.fn()}
      isInView={(v) => v === '2021'}
    />
  );
  await user.press(screen.getByText('Year'));

  const struckThrough = StyleSheet.flatten(screen.getByTestId('option-label-2020').props.style);
  expect(struckThrough).toMatchObject({ textDecorationLine: 'line-through' });

  const notStruckThrough = StyleSheet.flatten(screen.getByTestId('option-label-2021').props.style);
  expect(notStruckThrough.textDecorationLine).toBeUndefined();
});

test('Clear removes every selected value', async () => {
  const onChange = jest.fn();
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={['alice', 'bob']} onChange={onChange} />
  );
  await user.press(screen.getByText('Author'));

  await user.press(screen.getByText('Clear'));

  expect(onChange).toHaveBeenCalledWith([]);
});

test("a chip's close icon removes just that value", async () => {
  const onChange = jest.fn();
  const user = userEvent.setup();
  await renderField(
    <MultiSelectField label="Author" items={['alice', 'bob']} selectedValues={['alice', 'bob']} onChange={onChange} />
  );

  await user.press(screen.getAllByLabelText('Close')[0]);

  expect(onChange).toHaveBeenCalledWith(['bob']);
});
