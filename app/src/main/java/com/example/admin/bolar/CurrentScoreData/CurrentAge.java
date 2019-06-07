package com.example.admin.bolar.CurrentScoreData;

public class CurrentAge {

    private String State;
    private int Months;
    private int Years;

    public CurrentAge() {}

    public CurrentAge(String State, int Months, int Years){
        this.State = State;
        this.Months = Months;
        this.Years = Years;
    }

    public String getState(){
        return State;
    }

    public int getMonths(){
        return Months;
    }

    public int getYears(){
        return Years;
    }
}
