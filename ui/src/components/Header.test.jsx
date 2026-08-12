import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, within} from '@testing-library/react';
import Header from './Header';

const noop = () => {};

const renderHeader = (props) => render(
    <Header availableDevices={{}} setSelectedDeviceName={noop} selectedDeviceName={null}
            selectedNav="catalogue" setSelectedNav={noop} whatsNewCount={0} onWhatsNewOpen={noop}
            {...props}/>
);

describe('Header nav tabs', () => {
    it('always shows the mobile menu trigger, even with only one tab and no other devices', () => {
        // Below `sm` it's the only way to reach What's New/Pair Mobile App (see the "Header
        // mobile overflow menu" tests below), so - unlike the desktop trigger - it can't disappear
        // just because there's no device/tab choice to make too.
        renderHeader({});
        expect(screen.getByRole('button', {name: 'show more'})).toBeInTheDocument();
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
        // Queries the dialog by role rather than by the "Pair Mobile App" text itself - that text
        // now also lives (permanently, since the mobile menu is keepMounted) in the mobile
        // overflow menu's own "Pair Mobile App" entry, so it's no longer unique to the dialog.
        renderHeader({});
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'Pair Mobile App'}));

        expect(within(screen.getByRole('dialog')).getByText('Pair Mobile App')).toBeInTheDocument();
    });
});

describe('Header mobile overflow menu', () => {
    it("includes a What's New entry that opens What's New and closes the menu", () => {
        const onWhatsNewOpen = vi.fn();
        renderHeader({onWhatsNewOpen});

        fireEvent.click(screen.getByRole('button', {name: 'show more'}));
        fireEvent.click(screen.getByRole('menuitem', {name: /What's New/}));

        expect(onWhatsNewOpen).toHaveBeenCalled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('includes a Pair Mobile App entry that opens the pairing dialog and closes the menu', () => {
        renderHeader({});

        fireEvent.click(screen.getByRole('button', {name: 'show more'}));
        fireEvent.click(screen.getByRole('menuitem', {name: 'Pair Mobile App'}));

        expect(within(screen.getByRole('dialog')).getByText('Pair Mobile App')).toBeInTheDocument();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it("shows a dot on the menu trigger when there's an unread What's New count", () => {
        const {container} = renderHeader({whatsNewCount: 3});
        expect(container.querySelector('.MuiBadge-dot')).not.toHaveClass('MuiBadge-invisible');
    });

    it("hides the dot on the menu trigger when there's no unread What's New count", () => {
        const {container} = renderHeader({whatsNewCount: 0});
        expect(container.querySelector('.MuiBadge-dot')).toHaveClass('MuiBadge-invisible');
    });
});
