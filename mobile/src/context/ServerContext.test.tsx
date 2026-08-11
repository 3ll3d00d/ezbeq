import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ServerProvider, useServerContext } from './ServerContext';

const Consumer = () => {
  const { connection, wsUrl, pair, unpair } = useServerContext();
  return (
    <View>
      <Text testID="connection">
        {connection === undefined ? 'loading' : connection === null ? 'unpaired' : connection.baseUrl}
      </Text>
      <Text testID="wsUrl">{wsUrl ?? 'none'}</Text>
      <Button onPress={() => pair({ baseUrl: 'http://192.168.1.23:9968' })}>Pair</Button>
      <Button onPress={() => unpair()}>Unpair</Button>
    </View>
  );
};

beforeEach(() => AsyncStorage.clear());

test('starts in the loading state, then resolves to unpaired with nothing persisted', async () => {
  await render(
    <ServerProvider>
      <Consumer />
    </ServerProvider>
  );

  await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('unpaired'));
  expect(screen.getByTestId('wsUrl')).toHaveTextContent('none');
});

test('pairing persists the connection and derives the ws url', async () => {
  await render(
    <ServerProvider>
      <Consumer />
    </ServerProvider>
  );
  await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('unpaired'));

  await act(async () => {
    fireEvent.press(screen.getByText('Pair'));
  });

  expect(screen.getByTestId('connection')).toHaveTextContent('http://192.168.1.23:9968');
  expect(screen.getByTestId('wsUrl')).toHaveTextContent('ws://192.168.1.23:9968/ws');
  expect(JSON.parse((await AsyncStorage.getItem('ezbeq:serverConnection'))!)).toEqual({
    baseUrl: 'http://192.168.1.23:9968',
  });
});

test('unpairing clears the persisted connection', async () => {
  await AsyncStorage.setItem(
    'ezbeq:serverConnection',
    JSON.stringify({ baseUrl: 'http://host:8080' })
  );

  await render(
    <ServerProvider>
      <Consumer />
    </ServerProvider>
  );
  await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('http://host:8080'));

  await act(async () => {
    fireEvent.press(screen.getByText('Unpair'));
  });

  expect(screen.getByTestId('connection')).toHaveTextContent('unpaired');
  expect(await AsyncStorage.getItem('ezbeq:serverConnection')).toBeNull();
});

test('useServerContext throws when used outside a ServerProvider', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(render(<Consumer />)).rejects.toThrow(
    'useServerContext must be used within a ServerProvider'
  );
  consoleError.mockRestore();
});
