import { render, screen, userEvent } from '@testing-library/react-native';

import SearchBar from './SearchBar';

test('calls onChangeText as the user types', async () => {
  const onChangeText = jest.fn();
  const user = userEvent.setup();
  await render(
    <SearchBar value="" onChangeText={onChangeText} showFilters={false} onToggleFilters={jest.fn()} />
  );

  await user.type(screen.getByPlaceholderText('Search…'), 'x');

  expect(onChangeText).toHaveBeenCalledWith('x');
});

test('shows a clear button only once there is text, and it clears on press', async () => {
  const onChangeText = jest.fn();
  const user = userEvent.setup();
  const { rerender } = await render(
    <SearchBar value="" onChangeText={onChangeText} showFilters={false} onToggleFilters={jest.fn()} />
  );
  expect(screen.queryByTestId('search-clear-icon')).toBeNull();

  await rerender(
    <SearchBar value="terminator" onChangeText={onChangeText} showFilters={false} onToggleFilters={jest.fn()} />
  );

  await user.press(screen.getByTestId('search-clear-icon'));

  expect(onChangeText).toHaveBeenCalledWith('');
});

test('calls onToggleFilters when the filter button is pressed', async () => {
  const onToggleFilters = jest.fn();
  const user = userEvent.setup();
  await render(
    <SearchBar value="" onChangeText={jest.fn()} showFilters={false} onToggleFilters={onToggleFilters} />
  );

  await user.press(screen.getByLabelText('Toggle filters'));

  expect(onToggleFilters).toHaveBeenCalled();
});
