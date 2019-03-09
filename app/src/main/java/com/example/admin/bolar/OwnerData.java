package com.example.admin.bolar;


import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

public class OwnerData {

    public Boolean corporate_flag;
    public String fullName;
    public String second_name;
    public String address;
    public String city;
    public String state;
    public String zip_code;
    public String first_name;
    public String middle_name;
    public String last_name;
    public String suffix;
    //public Date ended_at;
    //public Date started_at;

    public static OwnerData fromJSON(JSONObject json) throws JSONException {
        OwnerData ownerData = new OwnerData();

        if(!json.isNull("corporate_flag")){
            ownerData.corporate_flag = json.getBoolean("corporate_flag");
        }
        if(!json.isNull("name")){
            ownerData.fullName = json.getString("name");
        }
        if(!json.isNull("second_name")){
            ownerData.second_name = json.getString("second_name");
        }
        if(!json.isNull("address")){
            ownerData.address = json.getString("address");
        }
        if(!json.isNull("city")){
            ownerData.city = json.getString("city");
        }
        if(!json.isNull("state")){
            ownerData.state = json.getString("state");
        }
        if(!json.isNull("zip_code")){
            ownerData.zip_code = json.getString("zip_code");
        }
        if(!json.isNull("first_name")){
            ownerData.first_name = json.getString("first_name");
        }
        if(!json.isNull("middle_name")){
            ownerData.middle_name = json.getString("middle_name");
        }
        if(!json.isNull("last_name")){
            ownerData.last_name = json.getString("last_name");
        }
        if(!json.isNull("suffix")){
            ownerData.suffix = json.getString("suffix");
        }

        //ownerData.ended_at = json.getString("ended_at");
        //ownerData.started_at = json.getString("started_at");

        return ownerData;
    }
}
