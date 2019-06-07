package com.example.admin.bolar.CurrentScoreData;

public class CurrentMarks {
    private String State;
    private int Total;

    public CurrentMarks() {}

    public CurrentMarks(String State, int Total){
        this.State = State;
        this.Total = Total;
    }

    public String getState(){
        return State;
    }

    public int getLatePayments(){
        return Total;
    }
}
