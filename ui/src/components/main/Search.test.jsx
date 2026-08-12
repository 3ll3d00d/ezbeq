import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Search from './Search';

describe('Search', () => {
    it('shows the current text filter value', () => {
        render(<Search txtFilter="avengers" setTxtFilter={vi.fn()} showFilters={false} toggleShowFilters={vi.fn()}/>);
        expect(screen.getByRole('textbox', {name: 'search'})).toHaveValue('avengers');
    });

    it('calls setTxtFilter as the user types', () => {
        const setTxtFilter = vi.fn();
        render(<Search txtFilter="" setTxtFilter={setTxtFilter} showFilters={false} toggleShowFilters={vi.fn()}/>);

        fireEvent.change(screen.getByRole('textbox', {name: 'search'}), {target: {value: 'batman'}});

        expect(setTxtFilter).toHaveBeenCalledWith('batman');
    });

    it('hides the clear icon when the search box is empty', () => {
        const {container} = render(
            <Search txtFilter="" setTxtFilter={vi.fn()} showFilters={false} toggleShowFilters={vi.fn()}/>
        );

        expect(container.querySelector('[data-testid="ClearIcon"]')).toBeNull();
    });

    it('clears the text filter when the clear icon is clicked', () => {
        const setTxtFilter = vi.fn();
        const {container} = render(
            <Search txtFilter="avengers" setTxtFilter={setTxtFilter} showFilters={false} toggleShowFilters={vi.fn()}/>
        );

        fireEvent.click(container.querySelector('[data-testid="ClearIcon"]').closest('button'));

        expect(setTxtFilter).toHaveBeenCalledWith('');
    });

    it('reflects the showFilters state on the switch', () => {
        render(<Search txtFilter="" setTxtFilter={vi.fn()} showFilters={true} toggleShowFilters={vi.fn()}/>);
        expect(screen.getByRole('switch')).toBeChecked();
    });

    it('calls toggleShowFilters when the switch is toggled', () => {
        const toggleShowFilters = vi.fn();
        render(<Search txtFilter="" setTxtFilter={vi.fn()} showFilters={false} toggleShowFilters={toggleShowFilters}/>);

        fireEvent.click(screen.getByRole('switch'));

        expect(toggleShowFilters).toHaveBeenCalled();
    });
});
