import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Header from './Header';

const noop = () => {};

const renderHeader = (props) => render(
    <Header availableDevices={{}} setSelectedDeviceName={noop} selectedDeviceName={null}
            selectedNav="catalogue" setSelectedNav={noop} whatsNewCount={0} onWhatsNewOpen={noop}
            {...props}/>
);

describe('Header nav tabs', () => {
    it('shows no menu trigger when there is only one tab and no other devices', () => {
        renderHeader({});
        expect(screen.queryByRole('button', {name: 'show more'})).not.toBeInTheDocument();
    });

    it('adds Levels and Control tabs for a minidsp device', () => {
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'minidsp'}},
            selectedDeviceName: 'd1'
        });
        expect(screen.getByRole('button', {name: 'show more'})).toBeInTheDocument();
        expect(screen.getByText('Levels')).toBeInTheDocument();
        expect(screen.getByText('Control')).toBeInTheDocument();
    });

    it('adds only the Levels tab for a camilladsp device', () => {
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'camilladsp'}},
            selectedDeviceName: 'd1'
        });
        expect(screen.getByText('Levels')).toBeInTheDocument();
        expect(screen.queryByText('Control')).not.toBeInTheDocument();
    });

    it('adds no extra tabs for a device type with no dedicated view', () => {
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'stub'}},
            selectedDeviceName: 'd1'
        });
        expect(screen.queryByText('Levels')).not.toBeInTheDocument();
        expect(screen.queryByText('Control')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'show more'})).not.toBeInTheDocument();
    });

    it('selecting a tab calls setSelectedNav with its lowercased name', () => {
        const setSelectedNav = vi.fn();
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'minidsp'}},
            selectedDeviceName: 'd1',
            setSelectedNav
        });

        fireEvent.click(screen.getByText('Levels'));

        expect(setSelectedNav).toHaveBeenCalledWith('levels');
    });
});

describe('Header device menu', () => {
    it('shows a menu trigger for multiple devices even with only one tab', () => {
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'stub'}, d2: {name: 'd2', type: 'stub'}}
        });
        expect(screen.getByRole('button', {name: 'show more'})).toBeInTheDocument();
        expect(screen.getByText('d1')).toBeInTheDocument();
        expect(screen.getByText('d2')).toBeInTheDocument();
    });

    it('does not list devices when there is only one', () => {
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'stub'}}
        });
        expect(screen.queryByText('d1')).not.toBeInTheDocument();
    });

    it('selecting a device calls setSelectedDeviceName with its name', () => {
        const setSelectedDeviceName = vi.fn();
        renderHeader({
            availableDevices: {d1: {name: 'd1', type: 'stub'}, d2: {name: 'd2', type: 'stub'}},
            setSelectedDeviceName
        });

        fireEvent.click(screen.getByText('d2'));

        expect(setSelectedDeviceName).toHaveBeenCalledWith('d2');
    });
});

describe("Header What's New badge", () => {
    it('shows the given count', () => {
        renderHeader({whatsNewCount: 5});
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('shows no badge (defaults to 0, which MUI renders as invisible) when no count is given', () => {
        renderHeader({whatsNewCount: undefined});
        expect(screen.queryByText(/^[1-9]/)).not.toBeInTheDocument();
    });

    it("calls onWhatsNewOpen when clicked", () => {
        const onWhatsNewOpen = vi.fn();
        renderHeader({onWhatsNewOpen});

        fireEvent.click(screen.getByRole('button', {name: "What's New"}));

        expect(onWhatsNewOpen).toHaveBeenCalled();
    });
});

describe('Header pair mobile app dialog', () => {
    it('opens the pairing dialog when the trigger is clicked', () => {
        renderHeader({});
        expect(screen.queryByText('Pair Mobile App')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'Pair Mobile App'}));

        expect(screen.getByText('Pair Mobile App')).toBeInTheDocument();
    });
});
